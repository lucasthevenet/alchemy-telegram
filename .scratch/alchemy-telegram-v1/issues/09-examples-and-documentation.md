# Publish examples and documentation

Status: ready-for-agent

Document the SDK and provider and add deployable examples covering every
architectural promise in the specification.

Blocked by: 05, 06, 07

## Acceptance criteria

- Examples cover localization, all handlers, multiple Bots, local fixtures,
  Worker event consumption, token rotation, and Webhook adoption.
- Security and state-backend guidance is explicit.
- Generated API documentation identifies Telegram Bot API 10.3.

## Comments

- Implemented a compiled Cloudflare Worker example with localized Bot
  Configuration, every Update Handler, two Bot Applications, Bot Event Source
  consumption, and local fixtures. Added token-rotation, Webhook-adoption, and
  encrypted-state guidance to the example and package documentation.
- Added a deterministic generated API reference for all 185 Telegram Bot API
  10.3 methods and included it in `generate:check` and the published package.
- `TelegramCloudflare.BotEventSourceLive` adapts the enclosing Worker's
  plan-time URL Output to Telegram registration and its runtime listener, so the
  example no longer needs a separate public-origin Config value.
