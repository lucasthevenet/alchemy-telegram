import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { BotApplication } from "../src/bot.ts";
import { makeWebhookHandler, resolveOrigin } from "../src/webhook.ts";

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
) => {
  const request = HttpServerRequest.fromWeb(
    new Request("https://example.test/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(supplied ? { "x-telegram-bot-api-secret-token": supplied } : {}),
      },
      body,
    }),
  );
  const result = await Effect.runPromise(
    makeWebhookHandler(application, secret, local)(request),
  );
  return HttpServerResponse.toWeb(result);
};

describe("Webhook handler", () => {
  test("resolves the two-stage accessor used by Cloudflare.Worker.URL", async () => {
    const origin = await Effect.runPromise(
      resolveOrigin(
        Effect.succeed(Effect.succeed("https://bot.example.com")) as never,
      ),
    );
    expect(origin).toBe("https://bot.example.com");
  });

  test("maps secret, body, schema, handler, and success outcomes", async () => {
    const ok = app(() => Effect.void);
    expect((await invoke(ok, "{}")).status).toBe(401);
    expect((await invoke(ok, "not-json", "webhook-secret")).status).toBe(400);
    expect((await invoke(ok, "{}", "webhook-secret")).status).toBe(400);
    expect(
      (
        await invoke(
          app(() => Effect.fail("boom")),
          JSON.stringify({ update_id: 1 }),
          "webhook-secret",
        )
      ).status,
    ).toBe(500);
    expect(
      (await invoke(ok, JSON.stringify({ update_id: 1 }), "webhook-secret"))
        .status,
    ).toBe(200);
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
