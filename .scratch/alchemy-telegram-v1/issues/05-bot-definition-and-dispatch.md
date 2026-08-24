# Implement Bot definition and Update dispatch

Status: ready-for-agent

Implement the deterministic Bot definition registry, immutable Handler Context,
exclusive dispatch, `Command`, `Hears`, `CallbackQuery`, typed `On`, direct
`handle(Update)`, and Effect requirement/error preservation.

Blocked by: 04

## Acceptance criteria

- Duplicate and nondeterministic registrations fail definition.
- Matching precedence and context narrowing are type- and runtime-tested.
- Command localization and typed arguments follow the specification.
- Callback queries auto-answer only under the agreed conditions.

## Comments

