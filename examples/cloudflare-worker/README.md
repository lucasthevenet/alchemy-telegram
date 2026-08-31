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
```

The provider configures existing Bot identities; it does not create or delete
them. Keep test and development Bots separate from production Bots because a
Bot can have only one active Webhook.

Install from the repository root:

```sh
bun install
```

## Develop with fixtures

Start local Alchemy development from this directory:

```sh
bunx alchemy dev
```

The Cloudflare Bot Event Source derives its URL from the enclosing Worker.
Under `alchemy dev`, that is the localhost address printed by Alchemy. The
Webhook provider registers the listeners and secret bindings but skips
Telegram's remote `setWebhook`, so local development cannot displace a Bot's
deployed Webhook.

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
bunx alchemy deploy
```

Alchemy provisions the Worker's public URL. The Bot Event Source uses that URL
as the Webhook origin and combines it with each `consumeEvents` path:

- `/api/telegram/notifications`
- `/api/telegram/operations`

The Worker initialization provides the Cloudflare adapter and consumes each Bot
Application independently:

```ts
yield* Telegram.consumeEvents(NotificationsBot, {
  path: "/api/telegram/notifications",
});
```

This is the same host/event-source split as
[Alchemy's GitHub event consumers](https://alchemy.run/github/events/#consume-events-from-a-worker):
the host adapter owns URL derivation, secret binding, and request delivery. Use
the lower-level `Telegram.Webhook("id", { token, url, ... })` resource when
another host or HTTP module owns the public URL and delivery path.

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
