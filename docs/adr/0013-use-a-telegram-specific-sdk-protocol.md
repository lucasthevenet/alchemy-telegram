# Use a Telegram-specific SDK protocol

Implement a Telegram-specific protocol in `distilled-telegram`: strictly encode
request inputs, tolerate additive response fields and variants, unwrap Telegram's
success/error envelope, preserve body-level retry parameters, and recursively
encode portable file inputs into collision-free multipart `attach://` parts.
Arbitrary Bot API calls do not retry automatically because non-idempotent methods
can duplicate effects; callers receive typed errors and reusable retry policies,
while the provider retries only operations it knows are idempotent. Separate API,
transport, and decode errors, and guarantee that token-bearing URLs and Webhook
secrets never appear in logs, error messages, or tracing attributes.
