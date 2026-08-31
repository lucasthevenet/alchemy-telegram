import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { inMemoryState } from "alchemy";
import { Worker, WorkerEnvironment } from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import type { BotApplication } from "../src/bot.ts";
import { BotEventSourceLive, webhookSecretEnvName } from "../src/Cloudflare.ts";
import { consumeEvents } from "../src/events.ts";

type Listener = (
  event: unknown,
) => Effect.Effect<unknown, never, never> | undefined;

interface TestRuntime {
  readonly Type: "Cloudflare.Worker";
  readonly LogicalId: string;
  readonly url: Output.Output<string | undefined>;
  readonly id: string;
  readonly env: Record<string, unknown>;
  readonly bind: (...args: readonly unknown[]) => unknown;
  get: <A>(key: string) => Effect.Effect<A | undefined>;
  set: (key: string, output: Output.Output) => Effect.Effect<string>;
  listen: (listener: Listener | Effect.Effect<Listener>) => Effect.Effect<void>;
  serve?: (
    handler: unknown,
    options?: { readonly shape?: Record<string, unknown> },
  ) => Effect.Effect<void>;
}

const application = (calls: unknown[]): BotApplication => ({
  name: "Notifications",
  options: { token: "1:secret" },
  token: Redacted.make("1:secret"),
  commands: [],
  api: {} as never,
  identity: Effect.die("not used"),
  dispatch: (update) =>
    Effect.sync(() => {
      calls.push(update);
    }),
  handle: (update) =>
    Effect.sync(() => {
      calls.push(update);
    }),
});

describe("Cloudflare Bot event source", () => {
  test("plans a namespaced secret and Webhook from the enclosing Worker URL", async () => {
    const previousRuntime = globalThis.__ALCHEMY_RUNTIME__;
    globalThis.__ALCHEMY_RUNTIME__ = false;

    const listeners: Listener[] = [];
    const bindings = new Map<string, Output.Output>();
    const workerBindings: unknown[] = [];
    const runtime: TestRuntime = {
      Type: "Cloudflare.Worker",
      LogicalId: "TelegramWorker",
      url: Output.asOutput("https://bots.example.com"),
      id: "TelegramWorker",
      env: {},
      bind: () => (data: unknown) =>
        Effect.sync(() => {
          workerBindings.push(data);
        }),
      get: <A>() => Effect.succeed(undefined as A | undefined),
      set: (key, output) =>
        Effect.sync(() => {
          bindings.set(key, output);
          return key;
        }),
      listen: (listener) =>
        Effect.gen(function* () {
          listeners.push(
            Effect.isEffect(listener) ? yield* listener : listener,
          );
        }),
      serve: (handler) => runtime.listen(handler as Listener),
    };
    const stack = {
      name: "Test",
      stage: "test",
      resources: {},
      bindings: {},
      actions: {},
    };

    try {
      await Effect.runPromise(
        consumeEvents(Effect.succeed(application([])), {
          events: ["message", "callback_query"],
          dropPendingUpdates: true,
        }).pipe(
          Effect.provide(BotEventSourceLive),
          Effect.provideService(
            Worker.Self,
            runtime as unknown as Effect.Success<typeof Worker>,
          ),
          Effect.provideService(WorkerEnvironment, {}),
          Effect.provideService(
            RuntimeContext,
            runtime as unknown as RuntimeContext["Service"],
          ),
          Effect.provideService(Stack, stack),
        ),
      );

      const resources = stack.resources as Record<
        string,
        { readonly Type: string; readonly Props: Record<string, unknown> }
      >;
      expect(Object.keys(resources).sort()).toEqual([
        "TelegramWorker/NotificationsWebhook",
        "TelegramWorker/NotificationsWebhookSecret",
      ]);
      expect(resources["TelegramWorker/NotificationsWebhookSecret"]?.Type).toBe(
        "Alchemy.Random",
      );

      const webhook = resources["TelegramWorker/NotificationsWebhook"]!;
      expect(webhook.Type).toBe("Telegram.Bot.Webhook");
      expect(webhook.Props.events).toEqual(["message", "callback_query"]);
      expect(webhook.Props.dropPendingUpdates).toBe(true);
      expect(
        await Effect.runPromise(
          Output.evaluate(webhook.Props.url as Output.Output<string>, {}).pipe(
            Effect.provide(inMemoryState()),
          ),
        ),
      ).toBe("https://bots.example.com/__alchemy/telegram/Notifications");
      expect(bindings.has(webhookSecretEnvName("Notifications"))).toBe(true);
      expect(workerBindings).toEqual([
        {
          bindings: [
            {
              type: "self_url",
              name: "WORKER_URL",
            },
          ],
        },
      ]);
      expect(listeners).toHaveLength(1);
    } finally {
      globalThis.__ALCHEMY_RUNTIME__ = previousRuntime;
    }
  });

  test("claims its path without also running the Worker's default fetch", async () => {
    const previousRuntime = globalThis.__ALCHEMY_RUNTIME__;
    globalThis.__ALCHEMY_RUNTIME__ = true;

    const listeners: Listener[] = [];
    const dispatched: unknown[] = [];
    let defaultFetches = 0;
    const runtime: TestRuntime = {
      Type: "Cloudflare.Worker",
      LogicalId: "TelegramWorker",
      url: Output.asOutput("https://bots.example.com"),
      id: "TelegramWorker",
      env: {},
      bind: () => () => Effect.void,
      get: <A>(key: string) =>
        Effect.succeed(
          (key === webhookSecretEnvName("Notifications")
            ? Redacted.make("webhook-secret")
            : false) as A,
        ),
      set: (key) => Effect.succeed(key),
      listen: (listener) =>
        Effect.gen(function* () {
          listeners.push(
            Effect.isEffect(listener) ? yield* listener : listener,
          );
        }),
    };
    runtime.serve = (handler) => runtime.listen(handler as Listener);

    try {
      await Effect.runPromise(
        consumeEvents(Effect.succeed(application(dispatched)), {
          path: "/api/telegram/webhook",
          events: ["message"],
        }).pipe(
          Effect.provide(BotEventSourceLive),
          Effect.provideService(
            Worker.Self,
            runtime as unknown as Effect.Success<typeof Worker>,
          ),
          Effect.provideService(WorkerEnvironment, {
            WORKER_URL: "https://bots.example.com",
          }),
          Effect.provideService(
            RuntimeContext,
            runtime as unknown as RuntimeContext["Service"],
          ),
        ),
      );

      await Effect.runPromise(
        runtime.serve!((_event: unknown) =>
          Effect.sync(() => {
            defaultFetches += 1;
            return new Response("default");
          }),
        ),
      );

      const request = new Request(
        "https://bots.example.com/api/telegram/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": "webhook-secret",
          },
          body: JSON.stringify({ update_id: 1 }),
        },
      );
      const effects = listeners.flatMap((listener) => {
        const effect = listener({
          kind: "Cloudflare.Workers.WorkerEvent",
          type: "fetch",
          input: request,
        });
        return Effect.isEffect(effect) ? [effect] : [];
      });

      expect(effects).toHaveLength(1);
      const response = await Effect.runPromise(effects[0]!);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(200);
      expect(defaultFetches).toBe(0);
      expect(dispatched).toEqual([{ update_id: 1 }]);

      const otherEffects = listeners.flatMap((listener) => {
        const effect = listener({
          kind: "Cloudflare.Workers.WorkerEvent",
          type: "fetch",
          input: new Request("https://bots.example.com/health"),
        });
        return Effect.isEffect(effect) ? [effect] : [];
      });
      expect(otherEffects).toHaveLength(1);
      await Effect.runPromise(otherEffects[0]!);
      expect(defaultFetches).toBe(1);
    } finally {
      globalThis.__ALCHEMY_RUNTIME__ = previousRuntime;
    }
  });
});
