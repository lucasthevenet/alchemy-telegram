import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Sync, type Input } from "alchemy";
import * as Output from "alchemy/Output";
import * as AlchemyTest from "alchemy/Test/Bun";
import { Webhook, providers } from "../src/index.ts";

interface WebhookState {
  url: string;
  allowed_updates: readonly string[] | undefined;
}

interface ApiCall {
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const makeTelegramApi = () => {
  const webhook: WebhookState = { url: "", allowed_updates: undefined };
  const calls: ApiCall[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const method = new URL(request.url).pathname.split("/").at(-1)!;
      const body = (await request.json()) as Record<string, unknown>;
      calls.push({ method, body });

      if (method === "getMe") {
        return Response.json({
          ok: true,
          result: { id: 42, is_bot: true, first_name: "Provider Test Bot" },
        });
      }
      if (method === "getWebhookInfo") {
        return Response.json({
          ok: true,
          result: {
            url: webhook.url,
            has_custom_certificate: false,
            pending_update_count: 0,
            allowed_updates: webhook.allowed_updates,
          },
        });
      }
      if (method === "setWebhook") {
        webhook.url = body.url as string;
        webhook.allowed_updates = body.allowed_updates as
          | readonly string[]
          | undefined;
        return Response.json({ ok: true, result: true });
      }
      if (method === "deleteWebhook") {
        webhook.url = "";
        webhook.allowed_updates = undefined;
        return Response.json({ ok: true, result: true });
      }
      return Response.json(
        { ok: false, error_code: 404, description: "Unexpected Bot API call" },
        { status: 404 },
      );
    },
  });
  return { calls, server, webhook };
};

const alchemy = AlchemyTest.make({ providers: providers() });

alchemy.test.provider(
  "Webhook resolves deferred URLs and survives create, update, drift, and destroy",
  (stack) =>
    Effect.acquireUseRelease(
      Effect.sync(makeTelegramApi),
      ({ calls, server, webhook }) =>
        Effect.gen(function* () {
          const token = Redacted.make("42:test-token");
          let resolutions = 0;
          const deferredUrl = (url: string) =>
            Output.fromEffect(
              Effect.sync(() => {
                resolutions += 1;
                return url;
              }),
            );
          const resource = (url: Input<string>, events: readonly string[]) =>
            Webhook("ProviderLifecycleWebhook", {
              token,
              apiOrigin: server.url.origin,
              url,
              secretToken: Redacted.make("provider-test-secret"),
              events,
              dropPendingUpdates: true,
            });

          const firstUrl = "https://bot.example.test/telegram/first";
          const firstOutput = deferredUrl(firstUrl);
          expect(resolutions).toBe(0);
          const created = yield* stack.deploy(
            resource(firstOutput, ["message"]),
          );
          expect(resolutions).toBeGreaterThan(0);
          expect(created).toMatchObject({
            bot_id: 42,
            url: firstUrl,
            allowed_updates: ["message"],
          });
          expect(webhook).toEqual({
            url: firstUrl,
            allowed_updates: ["message"],
          });

          const secondUrl = "https://bot.example.test/telegram/second";
          const secondUpdates = ["message", "callback_query"] as const;
          const updated = yield* stack.deploy(
            resource(deferredUrl(secondUrl), secondUpdates),
          );
          expect(updated).toMatchObject({
            bot_id: 42,
            url: secondUrl,
            allowed_updates: secondUpdates,
          });
          expect(webhook).toEqual({
            url: secondUrl,
            allowed_updates: secondUpdates,
          });

          webhook.url = "https://drift.example.test/telegram";
          webhook.allowed_updates = ["edited_message"];
          const detected = yield* Sync.sync(
            { name: stack.name, stage: "test" },
            { dryRun: true },
          );
          expect(Object.values(detected.resources)[0]?.action).toBe("drifted");
          const repaired = yield* Sync.sync({
            name: stack.name,
            stage: "test",
          });
          expect(Object.values(repaired.resources)[0]?.action).toBe("repaired");
          expect(webhook).toEqual({
            url: secondUrl,
            allowed_updates: secondUpdates,
          });

          const registrations = calls.filter(
            ({ method }) => method === "setWebhook",
          );
          expect(registrations.map(({ body }) => body.url)).toEqual([
            firstUrl,
            secondUrl,
            secondUrl,
          ]);
          expect(registrations.at(-1)?.body).toMatchObject({
            url: secondUrl,
            secret_token: "provider-test-secret",
            allowed_updates: secondUpdates,
            drop_pending_updates: true,
          });

          yield* stack.destroy();
          expect(webhook).toEqual({ url: "", allowed_updates: undefined });
          expect(
            calls.filter(({ method }) => method === "deleteWebhook"),
          ).toHaveLength(1);
        }),
      ({ server }) => Effect.sync(() => server.stop(true)),
    ),
  { timeout: 30_000 },
);
