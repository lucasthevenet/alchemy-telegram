# alchemy-telegram

Effect-native Telegram bots managed with [Alchemy V2](https://alchemy.run/).

This monorepo publishes two lockstep packages:

- `distilled-telegram` — generated, Effect-native Telegram Bot API 10.3 SDK.
- `alchemy-telegram` — Alchemy providers plus a typed Bot DSL and Webhook event
  sources.

The provider configures an existing bot token. Telegram bot identity creation and
deletion remain outside its scope.

The [deployable Cloudflare Worker example](./examples/cloudflare-worker) covers
localized configuration, every Update Handler, multiple Bot Applications,
local fixtures, Worker event consumption, token rotation, Webhook adoption,
and production state security.

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

## Manage Webhook registration directly

`Webhook` is a first-class Alchemy resource, matching the Alchemy GitHub
provider's registration model. It owns Telegram's singleton Webhook for one Bot,
accepts a deferred `url` input, updates it in place, repairs deletion, and
unregisters only the URL it owns:

```ts
const registration = yield* Telegram.Webhook("NotificationsWebhook", {
  token: Config.redacted("TELEGRAM_BOT_TOKEN"),
  url: "https://bot.example.com/api/telegram/webhook",
  secretToken: Config.redacted("TELEGRAM_WEBHOOK_SECRET"),
  events: ["message", "callback_query"],
});
```

The provider maps `events` to Telegram's `allowed_updates` request field.

Use this lower-level resource when another host or HTTP module owns delivery.
The resource performs no host discovery. Its `url` accepts Alchemy Outputs, so
it can depend directly on another resource declared in the same stack.

## Consume events from a Worker

`consumeEvents` is the higher-level interface. It follows
[Alchemy's host/event-source pattern for GitHub](https://alchemy.run/github/events/#consume-events-from-a-worker)
and crosses the host-neutral `BotEventSource` seam; the Cloudflare adapter
declares the underlying Webhook, generates and binds its stable secret, claims
the delivery path, and dispatches verified Updates to the Bot Application:

```ts
import * as Cloudflare from "alchemy/Cloudflare";
import * as Telegram from "alchemy-telegram";
import * as TelegramCloudflare from "alchemy-telegram/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

export const TelegramWorker = Cloudflare.Worker(
  "TelegramWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    yield* Telegram.consumeEvents(NotificationsBot, {
      path: "/api/telegram/webhook",
      events: ["message", "callback_query"],
    });

    return {
      fetch: Effect.gen(function* () {
        return HttpServerResponse.text("ok");
      }),
    };
  }).pipe(Effect.provide(TelegramCloudflare.BotEventSourceLive)),
);
```

The adapter derives the registration URL from the enclosing Worker's URL. A
configured Worker domain therefore becomes the public Webhook origin without an
`origin` prop. `path` is optional; omitting it uses a deterministic path for the
Bot Application: `/__alchemy/telegram/<encoded Bot Application name>`.
Requests outside the claimed path continue to the Worker's own `fetch` handler.

Add the Telegram providers alongside the host providers in the stack:

```ts
import * as Layer from "effect/Layer";

export const providers = () =>
  Layer.mergeAll(Cloudflare.providers(), Telegram.providers());
```

The Bot Event Source owns a stable 32-byte `Alchemy.Random` secret. Runtime
requests are verified against Telegram's secret header and finish with `200`,
`400`, `401`, or `500`; a non-POST request on the claimed path receives `405`.
Under `alchemy dev`, the Worker has a localhost URL: the listener and bindings
remain active, but the Webhook provider deliberately skips Telegram's remote
`setWebhook`, so local fixtures cannot displace a deployed Webhook and may omit
the secret header.

`BotEventSource` is host-neutral; V1 ships only the Cloudflare Worker adapter.
Other hosts can provide the service themselves or combine the lower-level
`Telegram.Webhook` resource with delivery code they own.

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

## Release automation

Both packages are prepared and published in lockstep through GitHub Actions.
`bun run release:validate` checks deterministic generation, provenance, package
metadata, exports, and npm tarball contents without publishing. Publishing only
runs when a GitHub Release is published, after the secured live lifecycle suite
passes. See the [release guide](./docs/releasing.md) for setup and recovery.

The scheduled Telegram API watcher can only update its review branch and open or
comment on a PR. It never merges or publishes automatically.

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
requires a separately deployed public host and is covered by the Cloudflare Bot
Event Source tests until a deployed-host fixture is supplied.

`update:spec` is the only networked generation step. Normal generation uses the
pinned official HTML/currencies snapshot, a pinned GramIO parser, repository
patches, a normalized IR, differential oracle, Smithy JSON, and Distilled's
generator. Generated artifacts are committed and deterministic.

The accepted V1 specification is in
[`./.scratch/alchemy-telegram-v1/spec.md`](./.scratch/alchemy-telegram-v1/spec.md),
with architectural decisions in [`./docs/adr`](./docs/adr).

## License

Apache-2.0
