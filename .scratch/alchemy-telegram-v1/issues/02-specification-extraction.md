# Build Telegram specification extraction

Status: ready-for-agent

Snapshot Telegram Bot API 10.3 provenance, integrate a pinned GramIO-derived
extractor, normalize its output, apply the required `RichText` correction, and
compare against PaulSonOfLars' independent snapshot.

## Acceptance criteria

- Source hashes and parser provenance are committed.
- Normalized IR contains every 10.3 method and type.
- Structural invariants and stale-patch detection fail loudly.
- Extraction is deterministic and requires no live network during ordinary
  builds.

## Comments

