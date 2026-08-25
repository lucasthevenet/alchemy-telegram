# distilled-telegram

Generated Effect-native client for all 185 methods in Telegram Bot API 10.3.

```ts
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Telegram from "distilled-telegram";

const program = Telegram.sendMessage({ chat_id: 123456, text: "Hello" }).pipe(
  Effect.provide(Telegram.credentials({ token: "123:secret" })),
  Effect.provide(FetchHttpClient.layer),
);
```

Requests are validated strictly, response objects tolerate additive fields,
Telegram envelopes become typed errors, tokens are redacted from failures, and
arbitrary operations are not retried automatically. `Telegram.Files` provides
portable upload constructors.

See the generated [API reference](./API.md) for all Telegram Bot API 10.3
methods. The [workspace README](../../README.md) documents the provider,
generation model, and lifecycle guarantees.
