# Separate Bot dispatch from Webhook HTTP

Yielding a Bot Application returns its Effect-native API client, verified Bot
identity, and direct `handle(Update)` dispatcher. It does not expose `fetch`;
`Telegram.Webhook(Bot, { origin, path })` is the sole HTTP adapter, keeping Bot
logic directly testable while centralizing authentication, decoding,
acknowledgement, and HTTP error mapping.
