# Convert Telegram IR to Smithy and generate the SDK

Status: ready-for-agent

Convert the normalized Telegram IR into valid Smithy JSON and invoke Distilled's
generator to emit complete service schemas and operation methods.

Blocked by: 02

## Acceptance criteria

- All references and operation returns resolve.
- Telegram integers, unions, constraints, and InputFile positions are modeled.
- Generated TypeScript is committed and deterministic.
- Public SDK metadata exposes the Telegram Bot API version.

## Comments

