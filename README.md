# alchemy-telegram

Effect-native Telegram bots managed with [Alchemy V2](https://alchemy.run/).

This monorepo publishes two lockstep packages:

- `distilled-telegram` — generated, Effect-native Telegram Bot API 10.3 SDK.
- `alchemy-telegram` — Alchemy providers plus a typed Bot and Webhook DSL.

The provider configures an existing bot token. Telegram bot identity creation and
deletion remain outside its scope.

The [deployable Cloudflare Worker example](./examples/cloudflare-worker) covers
localized configuration, every Update Handler, multiple Bot Applications,
local fixtures, explicit origins, token rotation, Webhook adoption, and
production state security.

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
import * as Config from "effect/Config";
import * as Telegram from "alchemy-telegram";

const TelegramRoutes = Telegram.Webhook(NotificationsBot, {
  origin: Config.string("TELEGRAM_PUBLIC_ORIGIN"),
  path: "/api/telegram/webhook",
});
```

The origin must resolve during planning. Alchemy `2.0.0-beta.74` exposes
`Cloudflare.Worker.URL` as a runtime-deferred accessor, so use a literal, Config
value, or plan-resolvable Alchemy Output instead.

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

The generated [`distilled-telegram` API reference](./packages/distilled-telegram/API.md)
indexes all 185 methods and identifies the exact pinned Telegram Bot API
version.

## Ownership and lifecycle

Stable Alchemy resource types cover Profile, Command Sets, Webhook, Menu Button,
and Default Administrator Rights. Undeclared properties remain unmanaged;
removing a previously managed value restores Telegram's default. Token rotation
is accepted only when `getMe` returns the same bot ID. A foreign Webhook is
reported as unowned and requires explicit Alchemy adoption.

Telegram has no operation that clears the irreducible default Bot name. Removing
or destroying that declaration leaves its last value in place; localized name
overrides and all managed description fields are reset normally.

Bot tokens are redacted from display, but redaction is not encryption. Resource
state can contain their underlying values, and Webhook secrets are deliberately
persisted for stable deployments. Use an encrypted state backend such as
`Cloudflare.state()` in production, restrict access to the state and encryption
key, and never commit `.env`, plans, state exports, or credential-bearing logs.

## Development

```sh
bun install
bun run generate:check
bun run check
```

## Live tests

Live tests are deliberately separate from the ordinary test suite. Put a token
for a dedicated test Bot in the ignored root `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456:secret
```

Then run:

```sh
bun run test:live
```

The suite verifies live identity decoding, typed/redacted Bot API failures, and
the real Alchemy Command Set deploy → update → drift detection/repair → destroy
lifecycle. It snapshots the existing default Command Set and restores it in an
Effect release finalizer, including when an assertion fails. Do not terminate
the process with `kill -9`, because no in-process finalizer can run after an
unrecoverable process kill.

Default Bot Profile mutation is intentionally excluded from repeatable live
automation: Telegram applies approximately daily limits to name changes, and
the irreducible default name cannot be cleared. Webhook HTTP delivery also
requires a separately deployed public host and is covered by the portable route
tests until a host-specific deployment fixture is supplied.

`update:spec` is the only networked generation step. Normal generation uses the
pinned official HTML/currencies snapshot, a pinned GramIO parser, repository
patches, a normalized IR, differential oracle, Smithy JSON, and Distilled's
generator. Generated artifacts are committed and deterministic.

The accepted V1 specification is in
[`./.scratch/alchemy-telegram-v1/spec.md`](./.scratch/alchemy-telegram-v1/spec.md),
with architectural decisions in [`./docs/adr`](./docs/adr).

## License

Apache-2.0
