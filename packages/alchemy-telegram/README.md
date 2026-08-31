# alchemy-telegram

Alchemy V2 providers and an Effect-native Telegram Bot DSL, built on
`distilled-telegram`.

```ts
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Telegram from "alchemy-telegram";
import * as TelegramCloudflare from "alchemy-telegram/Cloudflare";

const Bot = Telegram.Bot(
  "Notifications",
  { token: Config.redacted("TELEGRAM_BOT_TOKEN") },
  Effect.gen(function* () {
    yield* Telegram.Command("start", { description: "Get started" }, (ctx) =>
      ctx.reply("Ready"),
    );
  }),
);

const Events = Telegram.consumeEvents(Bot, {
  path: "/api/telegram/webhook",
  events: ["message"],
}).pipe(Effect.provide(TelegramCloudflare.BotEventSourceLive));
```

Run `Events` in a Cloudflare Worker's initialization Effect and add
`Telegram.providers()` to the Alchemy stack. `consumeEvents` uses the
host-neutral `BotEventSource` service; `BotEventSourceLive` derives the
registration URL from its enclosing Worker and composes a stable secret, remote
registration, verified Update delivery, and Bot dispatch. For registration
without the event-source adapter, use the first-class
`Telegram.Webhook("id", { token, url, ... })` resource; its `url` accepts an
Alchemy Input directly.

See the [Cloudflare Worker example](../../examples/cloudflare-worker) for a
deployable multi-Bot stack, local fixtures, rotation, adoption, and security
guidance. The [workspace README](../../README.md) documents the complete
behavior and SDK usage, including the opt-in live lifecycle test command.
