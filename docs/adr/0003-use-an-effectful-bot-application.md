# Use an Effectful Bot Application

Expose `Telegram.Bot` as an Alchemy Effectful Constructor that unifies desired
Bot Configuration and runtime update handling while preserving strict phase
separation. Planning reconciles only serializable metadata, Worker initialization
builds and freezes the client and handler registry, and request handling verifies,
decodes, and dispatches updates; handler closures never enter Alchemy state.

