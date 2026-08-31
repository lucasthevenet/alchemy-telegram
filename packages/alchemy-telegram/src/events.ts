import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Telegram from "distilled-telegram";
import type { BotApplication } from "./bot.ts";

/** An Update field that Telegram can select through `allowed_updates`. */
export type EventName = Exclude<keyof Telegram.Update, "update_id">;

export interface ConsumeEventsOptions {
  /**
   * Path claimed by the host adapter. Defaults to a deterministic path based
   * on the Bot Application name.
   */
  readonly path?: string;
  /** Telegram Update events to request through `allowed_updates`. */
  readonly events?: readonly EventName[];
  /** Ask Telegram to discard queued updates during this reconciliation. */
  readonly dropPendingUpdates?: boolean;
}

export type BotEventSourceService = (
  application: BotApplication,
  options: ConsumeEventsOptions,
) => Effect.Effect<void>;

/**
 * Host-specific implementation for provisioning and consuming Bot updates.
 *
 * Applications call {@link consumeEvents}; host packages provide this service
 * to choose the public URL, secret binding, and request-delivery mechanism.
 */
export class BotEventSource extends Context.Service<
  BotEventSource,
  BotEventSourceService
>()("Telegram.BotEventSource") {}

/** Deterministic delivery path for a Bot Application. */
export const defaultEventPath = (applicationName: string): string =>
  `/__alchemy/telegram/${encodeURIComponent(applicationName)}`;

/** Shared path policy for deploy-time registration and runtime delivery. */
export const eventPath = (
  application: Pick<BotApplication, "name">,
  options: Pick<ConsumeEventsOptions, "path"> = {},
): string => {
  const path = options.path?.trim();
  if (!path) return defaultEventPath(application.name);
  return path.startsWith("/") ? path : `/${path}`;
};

/**
 * Provision and consume webhook deliveries for a Bot Application.
 *
 * The Bot Effect is evaluated once per Alchemy phase. Its concrete application
 * is then passed to the host-specific {@link BotEventSource} implementation.
 */
export const consumeEvents = <E, R>(
  bot: Effect.Effect<BotApplication, E, R>,
  options: ConsumeEventsOptions = {},
): Effect.Effect<void, E, R | BotEventSource> =>
  Effect.gen(function* () {
    const application = yield* bot;
    const source = yield* BotEventSource;
    yield* source(application, options);
  });

const secureEqual = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
};

const response = (status: number, body: Record<string, unknown>) =>
  HttpServerResponse.jsonUnsafe(body, { status });

/** @internal Public for host adapters and portable runtime conformance tests. */
export const makeWebhookHandler =
  <SecretReq, LocalReq>(
    application: BotApplication,
    secret: Effect.Effect<
      Redacted.Redacted<string> | undefined,
      never,
      SecretReq
    >,
    local: Effect.Effect<boolean, never, LocalReq>,
  ) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (request.method !== "POST") {
        return response(405, { ok: false, error: "method_not_allowed" });
      }

      const supplied = request.headers["x-telegram-bot-api-secret-token"] ?? "";
      const expected = yield* secret;
      const allowLocal = yield* local;
      if (
        !allowLocal &&
        (!expected || !secureEqual(supplied, Redacted.value(expected)))
      ) {
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
        .handle(update.success)
        .pipe(Effect.result);
      if (handled._tag === "Failure") {
        return response(500, { ok: false, error: "handler_failed" });
      }

      return response(200, { ok: true });
    });
