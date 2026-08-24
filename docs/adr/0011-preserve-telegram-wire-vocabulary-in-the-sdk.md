# Preserve Telegram wire vocabulary in the SDK

Generate `distilled-telegram` with Telegram's documented method names, type
names, and snake-case fields unchanged, and support a configurable Bot API
endpoint with `api.telegram.org` as the default. Direct correspondence with the
canonical documentation outweighs TypeScript casing conventions; the provider
package may expose a curated camel-case interface. Model Telegram integers as
Smithy longs and expose them as validated JavaScript safe-integer numbers.
