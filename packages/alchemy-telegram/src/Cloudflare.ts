import { Random } from "alchemy";
import { isWorkerEvent, Worker } from "alchemy/Cloudflare";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import { sanitizeKey } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import {
  BotEventSource,
  eventPath,
  makeWebhookHandler,
  type BotEventSourceService,
} from "./events.ts";
import { Webhook } from "./resources.ts";

type WorkerListener<A = unknown, R = never> = (
  event: unknown,
) => Effect.Effect<A, never, R> | void;

type WorkerRoutingContext = Pick<
  Effect.Success<typeof Worker>,
  "listen" | "serve"
>;

const requestPath = (request: Request): string | undefined => {
  try {
    return new URL(request.url).pathname;
  } catch {
    return undefined;
  }
};

/**
 * Keep the Worker's default fetch handler from also claiming event-source
 * paths. Alchemy 2.0.0-beta.74 runs overlapping listeners concurrently and
 * discards both response values, so the exclusion has to happen before the
 * default listener returns an Effect.
 */
const excludeClaimedPathsFromDefaultFetch = (
  runtime: WorkerRoutingContext,
  paths: ReadonlySet<string>,
): void => {
  const serve = runtime.serve.bind(runtime);

  runtime.serve = (handler, options) => {
    const previousListen = runtime.listen;
    const filter =
      <A, R>(listener: WorkerListener<A, R>): WorkerListener<A, R> =>
      (event) => {
        if (
          isWorkerEvent(event) &&
          event.type === "fetch" &&
          paths.has(requestPath(event.input as unknown as Request) ?? "")
        ) {
          return undefined;
        }
        return listener(event);
      };

    runtime.listen = (<A, R>(listener: WorkerListener<A, R>) =>
      previousListen(filter(listener))) as typeof runtime.listen;
    try {
      return serve(handler, options);
    } finally {
      runtime.listen = previousListen;
    }
  };
};

/** Environment binding used to carry a Bot's generated webhook secret. */
export const webhookSecretEnvName = (applicationName: string): string =>
  `ALCHEMY_TELEGRAM_WEBHOOK_SECRET_${sanitizeKey(applicationName)}`;

const isLocalUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
};

/**
 * Telegram Bot event source for Cloudflare Workers.
 *
 * Planning provisions a stable secret and a Telegram Webhook whose URL comes
 * from the enclosing Worker. Runtime claims the configured path, verifies and
 * decodes the delivery, and awaits the Bot Application's dispatcher.
 */
export const BotEventSourceLive = Layer.effect(
  BotEventSource,
  Effect.gen(function* () {
    const ctx = yield* Worker;
    const workerUrl = yield* Worker.URL;
    const createRandom = yield* Random;
    const createWebhook = yield* Webhook;
    const paths = new Set<string>();
    const names = new Set<string>();
    const tokens = new Set<string>();
    excludeClaimedPathsFromDefaultFetch(ctx, paths);

    return Effect.fn(function* (application, options) {
      const path = eventPath(application, options);
      const token = Redacted.value(application.token);

      if (paths.has(path)) {
        return yield* Effect.die(
          new Error(`Duplicate Telegram event path: ${path}`),
        );
      }
      if (names.has(application.name) || tokens.has(token)) {
        return yield* Effect.die(
          new Error(
            `Telegram Bot Application '${application.name}' is consumed more than once`,
          ),
        );
      }
      paths.add(path);
      names.add(application.name);
      tokens.add(token);

      let secretOutput = Output.asOutput(Redacted.make(""));

      if (!globalThis.__ALCHEMY_RUNTIME__) {
        const planned = yield* Namespace.push(
          ctx.LogicalId,
          Effect.gen(function* () {
            const random = yield* createRandom(
              `${application.name}WebhookSecret`,
              { bytes: 32 },
            );
            yield* createWebhook(`${application.name}Webhook`, {
              token: application.token,
              apiOrigin: application.options.apiOrigin,
              url: Output.interpolate`${ctx.url}${path}`,
              secretToken: random.text,
              events: options.events,
              dropPendingUpdates: options.dropPendingUpdates,
            });
            return random.text;
          }),
        );
        secretOutput = planned;
      }

      const secret = yield* Output.named(
        secretOutput,
        webhookSecretEnvName(application.name),
      );
      const local = workerUrl.pipe(Effect.map(isLocalUrl));

      yield* ctx.listen((event) => {
        if (!isWorkerEvent(event) || event.type !== "fetch") return;
        const request = event.input as unknown as Request;
        const pathname = requestPath(request);
        if (pathname !== path) return;

        return makeWebhookHandler(
          application,
          secret,
          local,
        )(HttpServerRequest.fromWeb(request)).pipe(
          Effect.map(HttpServerResponse.toWeb),
        );
      });
    }) as BotEventSourceService;
  }),
);
