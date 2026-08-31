import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { inMemoryState } from "alchemy";
import {
  Worker,
  WorkerEnvironment,
  type WorkerEvent,
} from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Output from "alchemy/Output";
import { Stack } from "alchemy/Stack";
import type { BotApplication } from "../src/bot.ts";
import { BotEventSourceLive, webhookSecretEnvName } from "../src/Cloudflare.ts";
import { consumeEvents } from "../src/events.ts";

type Listener = (
  event: WorkerEvent,
) => Effect.Effect<unknown, never, never> | undefined;

interface SelfUrlBinding {
  readonly type: "self_url";
  readonly name: string;
}

interface WorkerBindingPlan {
  readonly bindings: readonly SelfUrlBinding[];
}

interface TestRuntime {
  readonly Type: "Cloudflare.Worker";
  readonly LogicalId: string;
  readonly url: Output.Output<string | undefined>;
  readonly id: string;
  readonly env: Readonly<Record<string, never>>;
  readonly bind: (
    template: TemplateStringsArray,
  ) => (plan: WorkerBindingPlan) => Effect.Effect<void>;
  get: <A>(key: string) => Effect.Effect<A | undefined>;
  set: (key: string, output: Output.Output) => Effect.Effect<string>;
  listen: (listener: Listener | Effect.Effect<Listener>) => Effect.Effect<void>;
  serve?: (handler: Listener) => Effect.Effect<void>;
}

interface PlannedWebhook {
  readonly Type: "Telegram.Bot.Webhook";
  readonly Props: {
    readonly events?: readonly string[];
    readonly dropPendingUpdates?: boolean;
    readonly url: Output.Output<string>;
  };
}

interface PlannedRandom {
  readonly Type: "Alchemy.Random";
}

type PlannedResource = PlannedWebhook | PlannedRandom;
type PlannedResources = Readonly<Record<string, PlannedResource>>;

const workerService = (runtime: TestRuntime): Effect.Success<typeof Worker> => {
  // SAFETY: this test double implements every Worker field used by the
  // adapter; unrelated resource outputs are intentionally absent.
  return runtime as never;
};

const runtimeContext = (runtime: TestRuntime): RuntimeContext["Service"] => {
  // SAFETY: TestRuntime implements the runtime operations exercised by Output
  // bindings and the Bot Event Source.
  return runtime as never;
};

const fetchEvent = (request: Request): WorkerEvent => {
  // SAFETY: listeners under test read only the fetch discriminator and input;
  // Cloudflare supplies env/context in production but they are not observed.
  return {
    kind: "Cloudflare.Workers.WorkerEvent",
    type: "fetch",
    input: request,
  } as never;
};

const application = (calls: unknown[]): BotApplication => ({
  name: "Notifications",
  options: { token: "1:secret" },
  token: Redacted.make("1:secret"),
  commands: [],
  // SAFETY: these tests invoke only the supplied handle function and never use
  // the Bot API client.
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
    const workerBindings: WorkerBindingPlan[] = [];
    const runtime: TestRuntime = {
      Type: "Cloudflare.Worker",
      LogicalId: "TelegramWorker",
      url: Output.asOutput("https://bots.example.com"),
      id: "TelegramWorker",
      env: {},
      bind: () => (plan) =>
        Effect.sync(() => {
          workerBindings.push(plan);
        }),
      get: <A>() => {
        // SAFETY: the planning test has no runtime environment values.
        return Effect.succeed(undefined as A | undefined);
      },
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
      serve: (handler) => runtime.listen(handler),
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
          Effect.provideService(Worker.Self, workerService(runtime)),
          Effect.provideService(WorkerEnvironment, {}),
          Effect.provideService(RuntimeContext, runtimeContext(runtime)),
          Effect.provideService(Stack, stack),
        ),
      );

      // SAFETY: this planning run declares only the Random and Webhook
      // resources represented by PlannedResource.
      const resources = stack.resources as PlannedResources;
      expect(Object.keys(resources).toSorted()).toEqual([
        "TelegramWorker/NotificationsWebhook",
        "TelegramWorker/NotificationsWebhookSecret",
      ]);
      expect(resources["TelegramWorker/NotificationsWebhookSecret"]?.Type).toBe(
        "Alchemy.Random",
      );

      const webhook = resources["TelegramWorker/NotificationsWebhook"];
      if (!webhook || webhook.Type !== "Telegram.Bot.Webhook") {
        throw new Error("Expected the planned Telegram Webhook");
      }
      expect(webhook.Props.events).toEqual(["message", "callback_query"]);
      expect(webhook.Props.dropPendingUpdates).toBe(true);
      expect(
        await Effect.runPromise(
          Output.evaluate(webhook.Props.url, {}).pipe(
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
        // SAFETY: this deterministic test environment stores only the named
        // webhook secret and the false local-development sentinel.
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
    runtime.serve = (handler) => runtime.listen(handler);

    try {
      await Effect.runPromise(
        consumeEvents(Effect.succeed(application(dispatched)), {
          path: "/api/telegram/webhook",
          events: ["message"],
        }).pipe(
          Effect.provide(BotEventSourceLive),
          Effect.provideService(Worker.Self, workerService(runtime)),
          Effect.provideService(WorkerEnvironment, {
            WORKER_URL: "https://bots.example.com",
          }),
          Effect.provideService(RuntimeContext, runtimeContext(runtime)),
        ),
      );

      await Effect.runPromise(
        runtime.serve!(() =>
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
        const effect = listener(fetchEvent(request));
        return Effect.isEffect(effect) ? [effect] : [];
      });

      expect(effects).toHaveLength(1);
      const response = await Effect.runPromise(effects[0]!);
      if (!(response instanceof Response)) {
        throw new Error("Expected the Telegram listener to return a Response");
      }
      expect(response.status).toBe(200);
      expect(defaultFetches).toBe(0);
      expect(dispatched).toEqual([{ update_id: 1 }]);

      const otherEffects = listeners.flatMap((listener) => {
        const effect = listener(
          fetchEvent(new Request("https://bots.example.com/health")),
        );
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
