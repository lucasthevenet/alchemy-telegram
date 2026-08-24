# Add lockstep release automation

Status: ready-for-agent

Add lockstep release preparation, package validation, generated-drift checks,
and a scheduled Telegram documentation watcher that opens review-only updates.

Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09

## Acceptance criteria

- Both packages publish as `0.1.0` with correct artifacts and provenance.
- Release validation enforces all V1 completion criteria.
- The watcher never merges or publishes automatically.

## Comments

