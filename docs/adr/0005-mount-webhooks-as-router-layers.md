# Superseded: Mount Webhooks as router Layers

Superseded by ADR 0017. The original design returned an Effect `HttpRouter`
Layer from `Telegram.WebhookRoute(Bot, { origin, path })` and required the
caller to supply the public origin.

The current design uses the host-neutral `BotEventSource` seam.
`Telegram.consumeEvents(Bot, options)` delegates registration and delivery to a
host adapter. The Cloudflare adapter derives the delivery URL from its enclosing
Worker, so the high-level interface has no `origin` prop and does not require
callers to build or merge router Layers.
