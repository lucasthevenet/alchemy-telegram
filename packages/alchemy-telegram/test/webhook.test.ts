import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { BotApplication } from "../src/bot.ts";
import {
  BotEventSource,
  consumeEvents,
  defaultEventPath,
  makeWebhookHandler,
} from "../src/events.ts";

const secret = Redacted.make("webhook-secret");

const app = (dispatch: BotApplication["dispatch"]): BotApplication => ({
  name: "Test",
  options: { token: "1:secret" },
  token: Redacted.make("1:secret"),
  commands: [],
  api: {} as never,
  identity: Effect.die("not used"),
  dispatch,
  handle: dispatch,
});

const invoke = async (
  application: BotApplication,
  body: string,
  supplied?: string,
  local = false,
  expected: Effect.Effect<
    Redacted.Redacted<string> | undefined
  > = Effect.succeed(secret),
  method = "POST",
) => {
  const request = HttpServerRequest.fromWeb(
    new Request("https://example.test/webhook", {
      method,
      headers: {
        "content-type": "application/json",
        ...(supplied ? { "x-telegram-bot-api-secret-token": supplied } : {}),
      },
      ...(method === "GET" || method === "HEAD" ? {} : { body }),
    }),
  );
  const result = await Effect.runPromise(
    makeWebhookHandler(application, expected, Effect.succeed(local))(request),
  );
  return HttpServerResponse.toWeb(result);
};

describe("Bot events", () => {
  test("uses a deterministic event path for each Bot Application", () => {
    expect(defaultEventPath("Notifications Bot/Primary")).toBe(
      "/__alchemy/telegram/Notifications%20Bot%2FPrimary",
    );
  });

  test("delegates the Bot and options through the BotEventSource seam", async () => {
    const application = app(() => Effect.void);
    let evaluations = 0;
    const bot = Effect.sync(() => {
      evaluations += 1;
      return application;
    });
    const options = {
      path: "telegram/notifications",
      events: ["message", "callback_query"],
      dropPendingUpdates: true,
    } as const;
    let receivedBot: unknown;
    let receivedOptions: unknown;

    const source: BotEventSource["Service"] = (candidate, configured) =>
      Effect.sync(() => {
        receivedBot = candidate;
        receivedOptions = configured;
      });

    await Effect.runPromise(
      consumeEvents(bot, options).pipe(
        Effect.provide(Layer.succeed(BotEventSource, source)),
      ),
    );

    expect(receivedBot).toBe(application);
    expect(receivedOptions).toBe(options);
    expect(evaluations).toBe(1);
  });
});

describe("Webhook handler", () => {
  test("rejects non-POST requests on the event path", async () => {
    const result = await invoke(
      app(() => Effect.void),
      JSON.stringify({ update_id: 1 }),
      "webhook-secret",
      false,
      Effect.succeed(secret),
      "PUT",
    );
    expect(result.status).toBe(405);
  });

  test("rejects a delivery without the configured secret", async () => {
    const ok = app(() => Effect.void);
    expect((await invoke(ok, "{}")).status).toBe(401);
  });

  test("rejects a delivery with the wrong secret", async () => {
    const result = await invoke(
      app(() => Effect.void),
      JSON.stringify({ update_id: 1 }),
      "wrong-secret",
    );
    expect(result.status).toBe(401);
  });

  test("fails closed when the secret binding is unavailable", async () => {
    const result = await invoke(
      app(() => Effect.void),
      JSON.stringify({ update_id: 1 }),
      "webhook-secret",
      false,
      Effect.succeed(undefined),
    );
    expect(result.status).toBe(401);
  });

  test("rejects malformed JSON", async () => {
    const result = await invoke(
      app(() => Effect.void),
      "not-json",
      "webhook-secret",
    );
    expect(result.status).toBe(400);
  });

  test("rejects a payload that is not a Telegram Update", async () => {
    const result = await invoke(
      app(() => Effect.void),
      "{}",
      "webhook-secret",
    );
    expect(result.status).toBe(400);
  });

  test("asks Telegram to retry when Update dispatch fails", async () => {
    expect(
      (
        await invoke(
          app(() => Effect.fail("boom")),
          JSON.stringify({ update_id: 1 }),
          "webhook-secret",
        )
      ).status,
    ).toBe(500);
  });

  test("awaits Update dispatch before acknowledging the delivery", async () => {
    const updates: unknown[] = [];
    const result = await invoke(
      app((update) =>
        Effect.sync(() => {
          updates.push(update);
        }),
      ),
      JSON.stringify({ update_id: 1 }),
      "webhook-secret",
    );

    expect(result.status).toBe(200);
    expect(updates).toEqual([{ update_id: 1 }]);
  });

  test("allows local fixtures without the secret header", async () => {
    const result = await invoke(
      app(() => Effect.void),
      JSON.stringify({ update_id: 1 }),
      undefined,
      true,
    );
    expect(result.status).toBe(200);
  });
});
