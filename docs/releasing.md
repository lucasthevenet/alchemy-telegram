# Releasing

`distilled-telegram` and `alchemy-telegram` are prepared and published in
lockstep. The provider always depends on the exact SDK version.

## One-time GitHub and npm setup

Add `TELEGRAM_BOT_TOKEN` as a GitHub Actions repository secret. It must belong
to a dedicated Bot because scheduled and release validation temporarily mutates
and restores its default Command Set.

The first publication can use a granular npm access token with publish access,
stored as the `NPM_TOKEN` repository secret. The release workflow still passes
`--provenance` and has `id-token: write`, so npm emits provenance from the
GitHub-hosted runner.

After each package exists on npm, configure its npm trusted publisher with:

- GitHub owner: `lucasthevenet`
- Repository: `alchemy-telegram`
- Workflow: `release.yml`
- Allowed action: publish

Then remove `NPM_TOKEN`. Trusted publishing uses GitHub OIDC and automatically
generates provenance without a long-lived write token. If the repository is
private, npm cannot generate public provenance attestations.

## Prepare a release

Set both package versions and the provider's exact SDK dependency together:

```sh
bun run release:prepare 0.1.0
```

Review the manifest and lockfile diff, update release notes, then run the same
preflight used by CI:

```sh
bun run release:validate
```

The preflight enforces formatting, linting, type checking, unit and portable
integration tests, deterministic generation, Telegram Bot API 10.3 metadata,
source-provenance hashes, lockstep versions, exact dependencies, valid exports,
and npm tarball allowlists. It never publishes.

## Publish

Commit the prepared release, tag it `v0.1.0`, and publish the corresponding
GitHub Release. Only the `release.yml` workflow publishes packages. It repeats
the full preflight, runs the secured live Bot lifecycle suite, publishes
`distilled-telegram` first, and then publishes `alchemy-telegram` with npm
provenance.

Publishing to npm is not transactional. All validation runs before either
package is published, and the SDK goes first because the provider names its
exact version. If npm accepts the SDK but rejects the provider, diagnose the
provider failure instead of changing either version independently.

## Scheduled automation

- `live.yml` runs the secured lifecycle suite weekly and can be dispatched
  manually. It shares a concurrency group with releases so the dedicated Bot is
  never mutated by two workflows simultaneously.
- `telegram-api-watcher.yml` refreshes the three pinned upstream inputs weekly.
  When their normalized content changes, it force-updates one dedicated branch
  and opens or comments on a review PR. It has no npm credentials, no OIDC
  permission, no publish command, and no merge command. A maintainer must review
  the canonical diff, version assertions, semantic patches, generated output,
  and secured validation before merging.
