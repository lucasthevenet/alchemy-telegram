# Establish workspace and build contract

Status: ready-for-agent

Replace scaffold metadata with lockstep `0.1.0` package manifests, explicit
exports, exact internal dependencies, strict handwritten type-checking, and a
generated-SDK-only checking concession. Add deterministic build, format, lint,
test, and generation scripts.

## Acceptance criteria

- Both packages build as ESM with declarations and correct exports.
- `alchemy-telegram` depends on the workspace `distilled-telegram` package.
- Handwritten code is fully type-checked.
- Root validation scripts fail on formatting, lint, type, test, or generated
  drift errors.

## Comments

