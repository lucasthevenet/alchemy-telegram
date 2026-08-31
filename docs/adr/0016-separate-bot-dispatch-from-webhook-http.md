# Separate Bot dispatch from Webhook HTTP

Yielding a Bot Application returns its Effect-native API client, verified Bot
identity, and direct `handle(Update)` dispatcher. It does not expose `fetch`.
`Telegram.consumeEvents(Bot, options)` crosses the host-neutral
`BotEventSource` seam, keeping Bot logic directly testable while a host adapter
centralizes registration, authentication, decoding, acknowledgement, and HTTP
error mapping. The Cloudflare adapter registers a Worker event listener rather
than taking ownership of the Worker's fetch handler.
