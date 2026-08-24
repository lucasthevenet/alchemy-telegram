import { afterEach, describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Unowned } from "alchemy/AdoptPolicy";
import {
  BotIdentityMismatch,
  CommandSet,
  CommandSetProvider,
  WebhookConfig,
  WebhookProvider,
} from "../src/resources.ts";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const lifecycleInput = {
  id: "Commands",
  fqn: "Commands",
  instanceId: "test",
  session: {} as never,
  bindings: [],
};

describe("Alchemy Telegram providers", () => {
  test("reconciles a command set and accepts same-bot token rotation", async () => {
    const methods: string[] = [];
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1)!;
        methods.push(method);
        if (method === "getMe") {
          return Response.json({
            ok: true,
            result: { id: 42, is_bot: true, first_name: "Bot" },
          });
        }
        if (method === "getMyCommands") {
          return Response.json({ ok: true, result: [] });
        }
        return Response.json({ ok: true, result: true });
      },
    });
    const props = {
      token: Redacted.make("1:first"),
      apiOrigin: server.url.origin,
      commands: [{ command: "link", description: "Link account" }],
      scope: { type: "default" as const },
    };
    const first = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* CommandSet.Provider;
        return yield* provider.reconcile({
          ...lifecycleInput,
          news: props,
          olds: undefined,
          output: undefined,
        });
      }).pipe(Effect.provide(CommandSetProvider())),
    );
    expect(first.bot_id).toBe(42);
    expect(methods).toContain("setMyCommands");

    const rotated = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* CommandSet.Provider;
        return yield* provider.reconcile({
          ...lifecycleInput,
          news: { ...props, token: Redacted.make("1:rotated") },
          olds: props,
          output: first,
        });
      }).pipe(Effect.provide(CommandSetProvider())),
    );
    expect(rotated.bot_id).toBe(42);
  });

  test("rejects a token that identifies a different bot", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          ok: true,
          result: { id: 99, is_bot: true, first_name: "Other" },
        }),
    });
    const props = {
      token: Redacted.make("99:other"),
      apiOrigin: server.url.origin,
      commands: [{ command: "link", description: "Link account" }],
      scope: { type: "default" as const },
    };
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const provider = yield* CommandSet.Provider;
          return yield* provider.reconcile({
            ...lifecycleInput,
            news: props,
            olds: props,
            output: {
              bot_id: 42,
              commands: props.commands,
              scope: props.scope,
            },
          });
        }).pipe(Effect.provide(CommandSetProvider())),
      ),
    );
    expect(error).toBeInstanceOf(BotIdentityMismatch);
  });

  test("marks a foreign non-empty webhook as unowned", async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1)!;
        if (method === "getMe") {
          return Response.json({
            ok: true,
            result: { id: 42, is_bot: true, first_name: "Bot" },
          });
        }
        return Response.json({
          ok: true,
          result: {
            url: "https://foreign.example/webhook",
            has_custom_certificate: false,
            pending_update_count: 0,
          },
        });
      },
    });
    const props = {
      token: Redacted.make("1:first"),
      apiOrigin: server.url.origin,
      url: "https://ours.example/webhook",
      secret_token: Redacted.make("secret"),
    };
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* WebhookConfig.Provider;
        return yield* provider.read!({
          id: "Webhook",
          fqn: "Webhook",
          instanceId: "test",
          olds: props,
          output: undefined,
        });
      }).pipe(Effect.provide(WebhookProvider())),
    );
    expect(Unowned.is(observed)).toBe(true);
  });
});
