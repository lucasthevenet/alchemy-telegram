import { afterEach, describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Unowned } from "alchemy/AdoptPolicy";
import {
  BotIdentityMismatch,
  CommandSet,
  CommandSetProvider,
  Profile,
  ProfileProvider,
  Webhook,
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
  session: {
    emit: () => Effect.void,
    done: () => Effect.void,
    note: () => Effect.void,
  },
  bindings: [],
};

const SetMyNameBody = Schema.Struct({
  name: Schema.optional(Schema.String),
});

const SetWebhookBody = Schema.Struct({
  url: Schema.String,
  secret_token: Schema.optional(Schema.String),
  allowed_updates: Schema.optional(Schema.Array(Schema.String)),
  drop_pending_updates: Schema.optional(Schema.Boolean),
});

describe("Alchemy Telegram providers", () => {
  test("destroys a default profile without trying to clear its required name", async () => {
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1)!;
        if (method === "getMe") {
          return Response.json({
            ok: true,
            result: { id: 42, is_bot: true, first_name: "Bot" },
          });
        }
        if (method === "setMyName") {
          const body = Schema.decodeUnknownSync(SetMyNameBody)(
            await request.json(),
          );
          if (!body.name) {
            return Response.json({
              ok: false,
              error_code: 400,
              description: "default bot name cannot be empty",
            });
          }
        }
        return Response.json({ ok: true, result: true });
      },
    });
    const props = {
      token: Redacted.make("1:first"),
      apiOrigin: server.url.origin,
      default: {
        name: "Managed Bot",
        description: "Managed description",
        short_description: "Managed short description",
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Profile.Provider;
        yield* provider.delete({
          ...lifecycleInput,
          olds: props,
          output: { bot_id: 42, profile: { "": props.default } },
        });
      }).pipe(Effect.provide(ProfileProvider())),
    );
  });

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
      secretToken: Redacted.make("secret"),
    };
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Webhook.Provider;
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

  test("reconciles the public Webhook resource", async () => {
    let setWebhookBody: typeof SetWebhookBody.Type | undefined;
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const method = new URL(request.url).pathname.split("/").at(-1)!;
        if (method === "getMe") {
          return Response.json({
            ok: true,
            result: { id: 42, is_bot: true, first_name: "Bot" },
          });
        }
        if (method === "setWebhook") {
          setWebhookBody = Schema.decodeUnknownSync(SetWebhookBody)(
            await request.json(),
          );
        }
        return Response.json({ ok: true, result: true });
      },
    });
    const props = {
      token: Redacted.make("1:first"),
      apiOrigin: server.url.origin,
      url: "https://ours.example/webhook",
      secretToken: Redacted.make("secret"),
      events: ["message", "callback_query"],
      dropPendingUpdates: true,
    };

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Webhook.Provider;
        return yield* provider.reconcile({
          ...lifecycleInput,
          news: props,
          olds: undefined,
          output: undefined,
        });
      }).pipe(Effect.provide(WebhookProvider())),
    );

    expect(Webhook.Type).toBe("Telegram.Bot.Webhook");
    expect(output).toEqual({
      bot_id: 42,
      url: props.url,
      allowed_updates: props.events,
    });
    expect(setWebhookBody).toEqual({
      url: props.url,
      secret_token: "secret",
      allowed_updates: props.events,
      drop_pending_updates: true,
    });
  });

  test("does not delete a webhook that was replaced out of band", async () => {
    let observedUrl = "https://foreign.example/webhook";
    let deletes = 0;
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
        if (method === "getWebhookInfo") {
          return Response.json({
            ok: true,
            result: {
              url: observedUrl,
              has_custom_certificate: false,
              pending_update_count: 0,
            },
          });
        }
        if (method === "deleteWebhook") deletes++;
        return Response.json({ ok: true, result: true });
      },
    });
    const props = {
      token: Redacted.make("1:first"),
      apiOrigin: server.url.origin,
      url: "https://ours.example/webhook",
      secretToken: Redacted.make("secret"),
    };
    const remove = Effect.gen(function* () {
      const provider = yield* Webhook.Provider;
      return yield* provider.delete({
        ...lifecycleInput,
        olds: props,
        output: {
          bot_id: 42,
          url: props.url,
        },
      });
    }).pipe(Effect.provide(WebhookProvider()));

    await Effect.runPromise(remove);
    expect(deletes).toBe(0);

    observedUrl = props.url;
    await Effect.runPromise(remove);
    expect(deletes).toBe(1);
  });
});
