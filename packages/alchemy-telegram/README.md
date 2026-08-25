# alchemy-telegram

Alchemy V2 providers and an Effect-native Telegram Bot DSL, built on
`distilled-telegram`.

```ts
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Telegram from "alchemy-telegram";

const Bot = Telegram.Bot(
  "Notifications",
  { token: Config.redacted("TELEGRAM_BOT_TOKEN") },
  Effect.gen(function* () {
    yield* Telegram.Command("start", { description: "Get started" }, (ctx) =>
      ctx.reply("Ready"),
    );
  }),
);

const Routes = Telegram.Webhook(Bot, {
  origin: "https://bot.example.com",
  path: "/api/telegram/webhook",
});
```

Add `Telegram.providers()` to the Alchemy stack and merge `Routes` into the
application's Effect `HttpRouter` route Layers. The caller always supplies the
plan-resolvable origin as a literal, Config value, or Alchemy Output. In Alchemy
`2.0.0-beta.74`, `Cloudflare.Worker.URL` itself is runtime-deferred and is not a
plan-time Webhook origin.

See the [Cloudflare Worker example](../../examples/cloudflare-worker) for a
deployable multi-Bot stack, local fixtures, rotation, adoption, and security
guidance. The [workspace README](../../README.md) documents the complete
behavior and SDK usage, including the opt-in live lifecycle test command.
