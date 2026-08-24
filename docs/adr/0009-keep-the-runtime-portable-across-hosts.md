# Keep the runtime portable across supported hosts

Keep Bot definition, Update decoding, dispatch, and the Webhook `HttpRouter`
Layer platform-neutral across Node, Bun, and workerd. The caller supplies the
public origin explicitly, so host resources such as `Cloudflare.Worker.URL` stay
outside this package. The provider supports Webhooks only in V1; long polling
remains available through `distilled-telegram`, and multiple Bot Applications
may share a host through distinct Webhook paths. In local Alchemy development,
register the route and bindings but skip remote Webhook reconciliation for local
origins; support local fixture posts and warn before a development Bot can
displace an existing Webhook.
