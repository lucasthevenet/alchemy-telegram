# Implement the Bot Event Source

Status: ready-for-agent

Implement the host-neutral `BotEventSource` service and
`Telegram.consumeEvents(Bot, options)`, plus the Cloudflare Worker adapter
exported as `TelegramCloudflare.BotEventSourceLive`. Compose Alchemy.Random
verification, deploy/runtime phase separation, HTTP error mapping,
local-development behavior, and direct fixture testing.

Blocked by: 05

## Acceptance criteria

- The Cloudflare adapter derives the public URL from its enclosing Worker; the
  high-level interface has no `origin` prop.
- Webhook secret generation and binding are stable and redacted.
- The adapter claims only its delivery path, verifies, decodes, awaits,
  dispatches, and maps status codes while unrelated Worker requests fall
  through.
- A Bot Application is evaluated once during planning and once during deployed
  Worker initialization.
- Local Worker URLs skip remote reconciliation without disabling local fixture
  delivery.

## Comments

- Registration remains available as the standalone
  `Telegram.Webhook("id", props)` resource. The high-level
  `Telegram.consumeEvents` interface crosses the `BotEventSource` seam so
  registration and delivery stay distinct while a host adapter can compose
  them.
