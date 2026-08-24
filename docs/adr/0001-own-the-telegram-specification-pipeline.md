# Own the Telegram specification pipeline

Generate `distilled-telegram` from a versioned, reproducible snapshot derived
from Telegram's canonical HTML Bot API documentation. Community parsers may
bootstrap extraction, but this project owns normalization, provenance,
validation, corrective patches, and reviewed updates because Telegram does not
publish an official machine-readable Bot API specification and existing public
OpenAPI documents lag behind the canonical API. Keep the source snapshot,
normalized model, patches, and converter in this monorepo initially; a scheduled
watcher opens review PRs, but never merges or publishes automatically. Bootstrap
extraction from a pinned GramIO parser and use PaulSonOfLars' independently
scraped model as a differential oracle. Unresolved references, missing returns,
invalid discriminators, changed source hashes, stale patches, and missing source
artifacts fail generation rather than shrinking the SDK silently.
The first release targets Telegram Bot API 10.3 and later versions enter through
the same reviewed update pipeline.
