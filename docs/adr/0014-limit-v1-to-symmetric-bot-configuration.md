# Limit V1 to symmetric Bot Configuration

V1 manages localized Bot Profile text, Command Sets, Webhook registration,
default menu button, default administrator rights, and runtime Update Handlers.
Defer profile photos because Telegram cannot expose enough state for strong drift
reconciliation, and defer per-chat settings, Sticker Sets, and other independent
objects until their ownership and lifecycle semantics are designed.

