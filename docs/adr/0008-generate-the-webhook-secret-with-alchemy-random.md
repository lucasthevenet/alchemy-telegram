# Generate the Webhook secret with Alchemy Random

Create one stable `Alchemy.Random` value per Webhook, pass its redacted output to
Telegram during `setWebhook`, and bind the same output to the Worker as
`secret_text` for request verification. The random value is persisted so normal
deploys do not rotate it: local Alchemy state must be treated as sensitive, and
production should use an encrypted state backend such as `Cloudflare.state()`
because `Redacted` prevents accidental disclosure but does not encrypt state.
V1 does not expose secret rotation because switching Telegram and the runtime is
not atomic and safe rotation requires temporary acceptance of two secrets.
