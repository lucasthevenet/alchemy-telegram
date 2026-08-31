# Generate the Webhook secret with Alchemy Random

For each high-level Bot Event Source, create one stable `Alchemy.Random` value,
pass its redacted output to Telegram during `setWebhook`, and let the host
adapter bind the same output as secret text for request verification. A caller
using the lower-level `Telegram.Webhook` resource supplies and distributes its
own optional secret instead.

The generated value is persisted so normal deploys do not rotate it: local
Alchemy state must be treated as sensitive, and production should use an
encrypted state backend such as `Cloudflare.state()` because `Redacted`
prevents accidental disclosure but does not encrypt state. V1 does not expose
secret rotation because switching Telegram and the runtime is not atomic and
safe rotation requires temporary acceptance of two secrets.
