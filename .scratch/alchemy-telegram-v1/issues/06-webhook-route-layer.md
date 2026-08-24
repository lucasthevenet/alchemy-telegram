# Implement the Webhook route Layer

Status: ready-for-agent

Implement `Telegram.Webhook(Bot, { origin, path })` as an Effect HttpRouter Layer
with Alchemy.Random verification, deploy/runtime phase separation, HTTP error
mapping, local-development behavior, and direct fixture testing.

Blocked by: 05

## Acceptance criteria

- The caller-provided origin is the sole public URL source.
- Webhook secret generation and binding are stable and redacted.
- Route handling verifies, decodes, awaits, dispatches, and maps status codes.
- Local origins skip remote reconciliation without disabling local routes.

## Comments

