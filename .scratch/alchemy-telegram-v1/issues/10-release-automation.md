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

- Added lockstep version preparation and a release preflight that validates all
  ordinary checks, deterministic generation, pinned provenance hashes, package
  exports, npm-compatible metadata, and tarball allowlists.
- Added GitHub Actions for pull-request CI, serialized scheduled live tests,
  GitHub Release-driven npm provenance publishing, and a Telegram API watcher
  restricted to a review branch and pull request.
- Added initial `0.1.0` package metadata, Apache-2.0 notices, npm publishing
  configuration, and operator documentation for token-to-OIDC migration.
- Clarified that the one-time first-publication token needs read/write access to
  all packages and explicit bypass-2FA permission before it is replaced by OIDC.
