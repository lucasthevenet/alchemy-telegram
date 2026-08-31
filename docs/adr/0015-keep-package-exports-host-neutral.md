# Keep package roots host-neutral

Keep both package roots host-neutral while allowing explicit host-adapter
subpaths. `distilled-telegram` exposes generated services plus handwritten
credentials, protocol, errors, and retry helpers. The `alchemy-telegram` root
exposes the Bot DSL, the host-neutral `BotEventSource` service and
`consumeEvents` helper, the standalone Webhook resource, and the provider
collection. It must not import a host implementation.

Publish the Cloudflare implementation separately from
`alchemy-telegram/Cloudflare` as `BotEventSourceLive`. This makes the host
dependency visible at the composition site and leaves room for another adapter
without changing the root interface. Persist provider resources under the
stable types `Telegram.Bot.Profile`, `Telegram.Bot.CommandSet`,
`Telegram.Bot.Webhook`, `Telegram.Bot.MenuButton`, and
`Telegram.Bot.DefaultAdministratorRights`.
