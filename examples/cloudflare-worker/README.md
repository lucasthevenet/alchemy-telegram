# Cloudflare Worker example

This deployable Alchemy stack runs two Telegram Bot Applications on one
Cloudflare Worker. It demonstrates localized Bot Profiles and Commands, every
Update Handler (`Command`, `Hears`, `CallbackQuery`, and `On`), distinct Webhook
paths, a normal health route, local fixture delivery, and an encrypted
Cloudflare state backend.

## Prerequisites

Create two dedicated Bots with BotFather and put their tokens in this example's
ignored `.env` file:

```dotenv
NOTIFICATIONS_TELEGRAM_BOT_TOKEN=123456:notifications-secret
OPERATIONS_TELEGRAM_BOT_TOKEN=654321:operations-secret
TELEGRAM_PUBLIC_HOST=bots.example.com
TELEGRAM_PUBLIC_ORIGIN=http://localhost:8787
```

The public host must belong to a Cloudflare zone available to the deployment
account. The provider configures existing Bot identities; it does not create or
delete them. Keep test and development Bots separate from production Bots
because a Bot can have only one active Webhook.

Install from the repository root:

```sh
bun install
```

## Develop with fixtures

Start local Alchemy development from this directory:

```sh
bunx alchemy dev
```

`TELEGRAM_PUBLIC_ORIGIN` is the explicit origin supplied by the application. The
localhost value makes the Webhook provider mount the routes without calling
Telegram's remote `setWebhook`, so local development cannot displace a Bot's
deployed Webhook. It must match the address printed by `alchemy dev`.

Other declared Bot Configuration is still reconciled against Telegram during
local development, which is why this example requires dedicated development
Bots. The example handlers only log so all fixture payloads remain local; use
`context.reply` or `context.answerCallbackQuery` in real application handlers.

In another terminal, post representative Updates to the local routes:

```sh
bun run fixture
```

If the dev server uses another address, pass it explicitly:

```sh
TELEGRAM_EXAMPLE_ORIGIN=http://localhost:3000 bun run fixture
```

The fixture covers the four handler classes and the second Bot. Local Webhooks
do not require Telegram's secret header; non-local Webhooks always do. Fixture
payloads should never contain production user data.

## Deploy

Authenticate Alchemy for Cloudflare, then deploy from this directory:

```sh
bunx alchemy login
TELEGRAM_PUBLIC_ORIGIN=https://bots.example.com bunx alchemy deploy
```

Or set the production origin in the deployment environment before running:

```sh
bunx alchemy deploy
```

For deployment, `TELEGRAM_PUBLIC_ORIGIN` must be `https://` plus the same host
as `TELEGRAM_PUBLIC_HOST`. Keeping the local origin intentionally prevents
remote registration.

The stack returns the Worker's URL. Each `Telegram.Webhook` combines that
caller-supplied origin with its own path:

- `/api/telegram/notifications`
- `/api/telegram/operations`

Another host can pass a literal or deferred origin instead:

```ts
Telegram.Webhook(NotificationsBot, {
  origin: "https://bots.example.com",
  path: "/api/telegram/notifications",
});
```

The provider never discovers the public host automatically.

With Alchemy `2.0.0-beta.74`, `Cloudflare.Worker.URL` is a runtime-deferred
accessor. Telegram needs the Webhook URL during planning, so use a plan-resolvable
literal, Config value, or Alchemy Output for `origin`.

## Rotate a Bot token

Token rotation is an environment-only deployment when the new token still
authenticates the same Telegram Bot ID:

1. Rotate the token with BotFather.
2. Replace only the corresponding value in `.env` or the deployment secret
   store.
3. Run `bunx alchemy deploy`.

During reconciliation the provider calls `getMe`. It accepts the replacement
only when the returned Bot ID matches the ID in state. A token for another Bot
fails with `BotIdentityMismatch`; it cannot silently retarget the existing Bot
Configuration. To target a different Bot intentionally, destroy the old
configuration while its credential is still valid, then create a new logical
Bot Application.

## Adopt an existing Webhook

Bot Profiles and Command Sets claim their currently observed values. A non-empty
Webhook pointing somewhere else is different: the first deploy reports it as
unowned and does not replace it.

Inspect the reported URL and verify that taking it over is intentional. Then run
one explicit adoption deploy:

```sh
bunx alchemy deploy --adopt
```

Adoption replaces the foreign URL, allowed-update selection, and secret with
this declaration. Future deploys reconcile it normally. Do not use `--adopt`
blindly in CI: it applies to every adoption conflict in that deployment.

## Security and state

The example deliberately uses `Cloudflare.state()`. Its remote state store
encrypts resource state at rest with a separately stored key. Treat the state,
its credentials, and its encryption key as production secrets and restrict
Cloudflare access accordingly.

`Config.redacted` prevents accidental token rendering in logs and diagnostics;
it is not encryption. Resource state can contain the underlying Bot tokens, and
the generated Webhook secret is persisted so ordinary deploys remain stable.
Do not use plaintext local state for production. Never commit `.env`, exported
state, plans, fixture captures, or debug output containing credentials.

At runtime, expose only the exact POST Webhook paths. Requests to a deployed
Webhook must carry Telegram's `X-Telegram-Bot-Api-Secret-Token` header; the
adapter compares it before decoding or dispatching the Update. Do not add a
proxy rule that strips this header or bypasses the verified route.

Destroying the stack unregisters its Webhooks and managed Bot Configuration but
does not delete either Telegram Bot identity.
