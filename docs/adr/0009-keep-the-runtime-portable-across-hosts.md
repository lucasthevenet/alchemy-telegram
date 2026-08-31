# Keep the runtime portable across supported hosts

Keep Bot definition, Update decoding, dispatch, and the `BotEventSource`
interface host-neutral. Host behavior belongs in adapters: V1 ships
`TelegramCloudflare.BotEventSourceLive` from `alchemy-telegram/Cloudflare`, and
other hosts may implement the same service without changing Bot Applications.
The standalone `Telegram.Webhook` resource remains available when a caller owns
delivery or targets another host.

The Cloudflare adapter derives the public delivery URL from its enclosing
Worker, claims only its configured path, and leaves the Worker's own fetch
handler untouched for other requests. Multiple Bot Applications may share one
Worker through distinct paths. In local Alchemy development the Worker URL is
local, so the adapter installs its listener and bindings while the Webhook
provider skips remote `setWebhook`; local fixture posts remain available.
Long polling stays outside the high-level V1 runtime.
