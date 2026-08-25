import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Random, type Input } from "alchemy";
import * as AlchemyOutput from "alchemy/Output";
import * as Telegram from "distilled-telegram";
import type { BotApplication } from "./bot.ts";
import { WebhookConfig } from "./resources.ts";

export interface WebhookOptions {
  readonly origin:
    | Input<string>
    | Effect.Effect<Input<string>, unknown, unknown>;
  readonly path?: string;
  readonly allowedUpdates?: readonly string[];
  readonly dropPendingUpdates?: boolean;
}

/** @internal Resolves plan-time Alchemy inputs, including nested Effects. */
export const resolveOrigin = (
  input: WebhookOptions["origin"],
): Effect.Effect<string, unknown, unknown> =>
  Effect.gen(function* () {
    let current: unknown = input;
    for (let depth = 0; depth < 8; depth++) {
      if (typeof current === "string") return current;
      if (AlchemyOutput.isOutput(current)) {
        current = yield* current.asEffect();
        continue;
      }
      if (Config.isConfig(current) || Effect.isEffect(current)) {
        current = yield* current as Effect.Effect<unknown, unknown, unknown>;
        continue;
      }
      break;
    }
    return yield* Effect.die(
      new Error("Telegram webhook origin must resolve to a string"),
    );
  });

const secureEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
};

const isLocal = (origin: string): boolean => {
  const hostname = new URL(origin).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
};

const response = (status: number, body: Record<string, unknown>) =>
  HttpServerResponse.jsonUnsafe(body, { status });

/** @internal Public for portable runtime conformance tests. */
export const makeWebhookHandler =
  (
    application: BotApplication,
    secret: Redacted.Redacted<string>,
    local: boolean,
  ) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const supplied = request.headers["x-telegram-bot-api-secret-token"] ?? "";
      if (!local && !secureEqual(supplied, Redacted.value(secret))) {
        return response(401, { ok: false, error: "unauthorized" });
      }
      const json = yield* request.json.pipe(Effect.result);
      if (json._tag === "Failure") {
        return response(400, { ok: false, error: "invalid_json" });
      }
      const update = yield* Schema.decodeUnknownEffect(Telegram.Update)(
        json.success,
      ).pipe(Effect.result);
      if (update._tag === "Failure") {
        return response(400, { ok: false, error: "invalid_update" });
      }
      const handled = yield* application
        .dispatch(update.success)
        .pipe(Effect.result);
      if (handled._tag === "Failure") {
        return response(500, { ok: false, error: "handler_failed" });
      }
      return response(200, { ok: true });
    });

/**
 * Register Telegram webhook infrastructure and mount its verified POST route.
 */
export const Webhook = (
  bot: Effect.Effect<BotApplication, any, any>,
  options: WebhookOptions,
): Layer.Layer<never, never, any> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const application = yield* bot;
      const origin = (yield* resolveOrigin(options.origin)).replace(/\/+$/, "");
      const path = options.path?.startsWith("/")
        ? options.path
        : `/${options.path ?? "api/telegram/webhook"}`;
      const random = yield* Random(`${application.name}WebhookSecret`, {
        bytes: 32,
      });
      const secretAccessor = yield* random.text;
      const secret = yield* secretAccessor;
      yield* WebhookConfig(`${application.name}Webhook`, {
        token: application.token,
        apiOrigin: application.options.apiOrigin,
        url: `${origin}${path}`,
        secret_token: random.text,
        allowed_updates: options.allowedUpdates,
        drop_pending_updates: options.dropPendingUpdates,
      });
      const local = isLocal(origin);
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "POST",
        path as HttpRouter.PathInput,
        makeWebhookHandler(application, secret, local),
      );
    }).pipe(Effect.orDie),
  );
