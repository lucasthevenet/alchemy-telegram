import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Telegram from "alchemy-telegram";
import * as TelegramCloudflare from "alchemy-telegram/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const PublicHost = Config.string("TELEGRAM_PUBLIC_HOST");

const NotificationsBot = Telegram.Bot(
  "Notifications",
  {
    token: Config.redacted("NOTIFICATIONS_TELEGRAM_BOT_TOKEN"),
    profile: {
      default: {
        name: "Notifications",
        description: "Sends account notifications",
        shortDescription: "Account notifications",
      },
      locales: {
        es: {
          name: "Notificaciones",
          description: "Envía notificaciones de la cuenta",
          shortDescription: "Notificaciones de cuenta",
        },
      },
    },
  },
  Effect.gen(function* () {
    yield* Telegram.Command(
      "link",
      {
        description: "Link your account",
        locales: { es: "Vincula tu cuenta" },
        scopes: [{ type: "default" }],
      },
      (context) => Effect.logInfo(`Link requested for ${context.args}`),
    );

    yield* Telegram.Hears(/^(hello|hi)$/i, (context) =>
      Effect.logInfo(`Greeting matched: ${context.match?.[0]}`),
    );

    yield* Telegram.CallbackQuery(
      /^confirm:/,
      { autoAnswer: false },
      (context) => Effect.logInfo(`Confirmed ${context.match?.[0]}`),
    );

    yield* Telegram.On("message", (context) =>
      Effect.logInfo(
        `Fallback message ${context.message?.message_id ?? "unknown"}`,
      ),
    );
  }),
);

const OperationsBot = Telegram.Bot(
  "Operations",
  {
    token: Config.redacted("OPERATIONS_TELEGRAM_BOT_TOKEN"),
    profile: {
      default: {
        name: "Operations",
        description: "Reports operational status",
        shortDescription: "Operational status",
      },
    },
  },
  Effect.gen(function* () {
    yield* Telegram.Command(
      "status",
      { description: "Show service status" },
      (context) =>
        Effect.logInfo(
          `Status requested in chat ${context.message?.chat.id ?? "unknown"}`,
        ),
    );
  }),
);

const WorkerProgram = Effect.gen(function* () {
  yield* Telegram.consumeEvents(NotificationsBot, {
    path: "/api/telegram/notifications",
    events: ["message", "callback_query"],
  });
  yield* Telegram.consumeEvents(OperationsBot, {
    path: "/api/telegram/operations",
    events: ["message"],
  });

  return {
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "https://worker.invalid");
      if (request.method === "GET" && url.pathname === "/health") {
        return HttpServerResponse.jsonUnsafe({ ok: true });
      }
      return HttpServerResponse.text("Not Found", { status: 404 });
    }),
  };
}).pipe(Effect.provide(TelegramCloudflare.BotEventSourceLive));

export default Alchemy.Stack(
  "TelegramExample",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Telegram.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker(
      "TelegramWorker",
      { main: import.meta.url, domain: PublicHost },
      WorkerProgram,
    );

    return { url: worker.url };
  }),
);
