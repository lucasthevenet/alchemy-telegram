# Implement Telegram SDK credentials and protocol

Status: ready-for-agent

Implement credentials, endpoint configuration, response envelopes, typed errors,
portable InputFile handling, recursive multipart encoding, retry metadata, and
strict-request/tolerant-response decoding.

Blocked by: 03

## Acceptance criteria

- JSON and multipart operations execute across Node, Bun, and workerd.
- Tokens and Webhook secrets never appear in logs, errors, or traces.
- No arbitrary call retries automatically.
- Fake-server fixtures cover success, Telegram errors, transport errors, decode
  errors, retry parameters, and nested uploads.

## Comments

