# Consume Webhook deliveries through a Bot Event Source

Expose `Telegram.Webhook("id", props)` as the host-independent Alchemy resource
that owns the Bot API registration, with a deferred `url` input. Registration
does not imply a particular HTTP runtime.

Replace `WebhookRoute` with the host-neutral `BotEventSource` service and this
high-level interface:

```ts
yield* Telegram.consumeEvents(bot, {
  path: "/api/telegram/webhook",
  events: ["message", "callback_query"],
  dropPendingUpdates: false,
});
```

`consumeEvents` evaluates the Bot Application in both Alchemy phases: planning
declares its Bot Configuration, while deployed-host initialization rebuilds its
handler registry. It delegates Webhook provisioning and delivery to the
provided `BotEventSource` adapter. An adapter owns stable secret generation and
binding, derives its host URL, claims a delivery path, verifies and decodes
Updates, and awaits `bot.handle(update)`.

V1 provides `TelegramCloudflare.BotEventSourceLive` from
`alchemy-telegram/Cloudflare`. It derives the registration URL from the
enclosing Cloudflare Worker and therefore needs no caller-provided `origin`.
When no path is supplied it uses
`/__alchemy/telegram/<encoded Bot Application name>`. Other Worker requests
continue to the application's own fetch handler. Other hosts can implement
`BotEventSource`, or callers can combine the lower-level `Telegram.Webhook`
resource with delivery code they own.
