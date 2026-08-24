# Keep package exports host-neutral

Keep both package roots host-neutral and add no Cloudflare-specific subpath in
V1. `distilled-telegram` exposes generated services plus handwritten credentials,
protocol, errors, and retry helpers; `alchemy-telegram` exposes the Bot DSL,
Webhook route Layer, and provider collection. Persist hidden provider resources
under the stable types `Telegram.Bot.Profile`, `Telegram.Bot.CommandSet`,
`Telegram.Bot.Webhook`, `Telegram.Bot.MenuButton`, and
`Telegram.Bot.DefaultAdministratorRights`.

