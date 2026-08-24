# Implement Alchemy provider resources

Status: ready-for-agent

Implement Bot Profile, Command Set, Webhook, default Menu Button, and default
Administrator Rights resources and bundle them in `providers()`.

Blocked by: 04

## Acceptance criteria

- Resource Types match the accepted stable strings.
- Reconcile/delete/read/diff behavior is idempotent.
- Existing foreign Webhooks require adoption.
- Credential retargeting, partial ownership, reset, drift, and destroy semantics
  match the specification.

## Comments

