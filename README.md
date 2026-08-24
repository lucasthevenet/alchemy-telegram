# alchemy-telegram

Effect-native Telegram bots managed with [Alchemy V2](https://alchemy.run/).

This monorepo publishes two lockstep packages:

- `distilled-telegram` — generated, Effect-native Telegram Bot API 10.3 SDK.
- `alchemy-telegram` — Alchemy providers plus a typed Bot and Webhook DSL.

The provider configures an existing bot token. Telegram bot identity creation and
deletion remain outside its scope.

## Install

```sh
bun add alchemy-telegram distilled-telegram alchemy@2.0.0-beta.74 effect@rc
```

## Define a bot

```ts
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Telegram from "alchemy-telegram";

export const NotificationsBot = Telegram.Bot(
  "Notifications",
  {
    token: Config.redacted("TELEGRAM_BOT_TOKEN"),
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
      },
      (context) => context.reply(`Link code: ${context.args}`),
    );

    yield* Telegram.Hears(/^(hello|hi)$/i, (context) =>
      context.reply("Hello!"),
    );

    yield* Telegram.CallbackQuery(/^confirm:/, (context) =>
      Effect.logInfo(`Confirmed ${context.callbackQuery?.data}`),
    );

    yield* Telegram.On("message", (context) =>
      Effect.logDebug(`Unhandled message ${context.message?.message_id}`),
    );
  }),
);
```

Specialized handlers are exclusive and checked in declaration order. `On` is a
single fallback. Commands are parsed from Telegram `bot_command` entities;
callback queries are answered automatically after successful handling unless
`autoAnswer: false` is set. Calling `context.answerCallbackQuery(...)` answers
explicitly and suppresses the automatic second answer.

## Mount the Webhook route

`Webhook` returns the complete Effect `HttpRouter` route Layer. The origin is
explicit and may be a deferred Alchemy input:

```ts
import * as Cloudflare from "alchemy/Cloudflare";
import * as Telegram from "alchemy-telegram";

const TelegramRoutes = Telegram.Webhook(NotificationsBot, {
  origin: Cloudflare.Worker.URL,
  path: "/api/telegram/webhook",
});
```

Merge `TelegramRoutes` with the rest of the application's route Layers and add
the providers to the stack's provider Layer:

```ts
import * as Layer from "effect/Layer";

export const providers = () =>
  Layer.mergeAll(Cloudflare.providers(), Telegram.providers());
```

The Webhook owns a stable 32-byte `Alchemy.Random` secret. Runtime requests are
verified against Telegram's secret header and finish with `200`, `400`, `401`,
or `500`. A localhost origin registers the route but deliberately skips
Telegram's remote `setWebhook`, which makes fixture delivery safe during local
development.

The public origin is always supplied by the caller; the provider performs no
host discovery.

## Direct Bot API access

Every Telegram Bot API 10.3 method is exported from `distilled-telegram` and as
`Telegram.Api`:

```ts
const me = yield* Telegram.Api.getMe({});
const message = yield* Telegram.Api.sendMessage({
  chat_id: 123456,
  text: "Deployed",
});
```

Outside a `Bot` handler, provide credentials and an HTTP client:

```ts
program.pipe(
  Effect.provide(Telegram.Api.credentials({ token })),
  Effect.provide(FetchHttpClient.layer),
);
```

Uploads accept `Blob`, `File`, bytes, web streams, Effect byte streams, or
`Api.Files.fromPath(...)` on Node/Bun. Nested uploads are converted recursively
to Telegram `attach://` multipart references.

## Ownership and lifecycle

Stable Alchemy resource types cover Profile, Command Sets, Webhook, Menu Button,
and Default Administrator Rights. Undeclared properties remain unmanaged;
removing a previously managed value restores Telegram's default. Token rotation
is accepted only when `getMe` returns the same bot ID. A foreign Webhook is
reported as unowned and requires explicit Alchemy adoption.

Because Webhook secrets are persisted in Alchemy state, use an encrypted state
backend for production.

## Development

```sh
bun install
bun run generate:check
bun run check
```

`update:spec` is the only networked generation step. Normal generation uses the
pinned official HTML/currencies snapshot, a pinned GramIO parser, repository
patches, a normalized IR, differential oracle, Smithy JSON, and Distilled's
generator. Generated artifacts are committed and deterministic.

The accepted V1 specification is in
[`./.scratch/alchemy-telegram-v1/spec.md`](./.scratch/alchemy-telegram-v1/spec.md),
with architectural decisions in [`./docs/adr`](./docs/adr).

## License

Apache-2.0
