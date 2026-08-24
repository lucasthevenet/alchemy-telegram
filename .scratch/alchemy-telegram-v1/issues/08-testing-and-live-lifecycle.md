# Add complete test and live lifecycle coverage

Status: ready-for-agent

Build recorded fixtures, fake-server tests, provider lifecycle tests, leak tests,
runtime-matrix tests, and secured live tests against a dedicated Bot.

Blocked by: 04, 05, 06, 07

## Acceptance criteria

- Ordinary CI requires no Telegram credentials.
- Scheduled/release live CI restores singleton Bot settings.
- Tests cover plan/deploy/update/drift/adopt/destroy and same-Bot token rotation.
- Leak tests fail if tokens or secrets enter observable output.

## Comments

