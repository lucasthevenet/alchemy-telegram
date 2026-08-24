# Alchemy Telegram V1

## Objective

Publish two lockstep `0.1.0` packages:

- `distilled-telegram`: a complete Effect-native SDK for Telegram Bot API 10.3.
- `alchemy-telegram`: an Alchemy V2 provider and Effect-native Bot Application
  DSL built on `distilled-telegram`.

The provider manages configuration and runtime handling for existing Telegram
Bots. It does not create or delete Telegram Bot identities.

## Package boundaries

### `distilled-telegram`

- Preserve Telegram method names, type names, and snake-case wire fields.
- Generate every Bot API 10.3 operation and schema through Distilled's Smithy
  generator.
- Handwrite credentials, Telegram protocol, typed errors, retry helpers, and
  portable file-input support.
- Support Node, Bun, and workerd. Exclude browser use. Filesystem-path helpers
  are Node/Bun-only.
- Default to `https://api.telegram.org` and allow a configurable Bot API origin.
- Perform no automatic retry for arbitrary calls.

### `alchemy-telegram`

- Expose `Bot`, `Command`, `Hears`, `CallbackQuery`, `On`, and `Webhook` from the
  host-neutral package root.
- Publish an Alchemy provider collection using stable resource Types:
  - `Telegram.Bot.Profile`
  - `Telegram.Bot.CommandSet`
  - `Telegram.Bot.Webhook`
  - `Telegram.Bot.MenuButton`
  - `Telegram.Bot.DefaultAdministratorRights`
- Depend on the exact lockstep `distilled-telegram` version.
- Pin one exact Alchemy V2 beta until Alchemy's provider contract stabilizes.

## Specification pipeline

The canonical source is Telegram's Bot API HTML documentation and changelog.
The repository owns a reproducible pipeline:

```text
official HTML and currencies snapshot
  -> pinned GramIO-derived extraction
  -> normalized Telegram IR
  -> versioned semantic patches
  -> structural invariants and differential oracle
  -> Smithy JSON
  -> Distilled generation
```

Store source provenance, hashes, parser version/commit, Bot API version, the
normalized IR, patches, Smithy, and generated TypeScript in the repository.
Fail on unresolved references, missing returns, invalid discriminators, missing
source data, stale patches, non-determinism, or unexpected differential changes.
Patch GramIO's incomplete recursive `RichText` model before generation.

A scheduled watcher may open review PRs. It must not merge or publish.

## Telegram SDK protocol

- Place the Bot token in the request URL only at the final HTTP boundary.
- Never log or trace a token-bearing URL.
- Use JSON when inputs contain no uploaded bytes or streams.
- For uploads, walk inputs recursively, allocate collision-free part names,
  replace nested files with `attach://<name>`, serialize nested form values, and
  append each file as a multipart part.
- Unwrap `{ ok: true, result }` into the generated operation output.
- Decode `{ ok: false, error_code, description, parameters? }` into
  `TelegramApiError`.
- Keep transport and decode errors separate.
- Preserve `retry_after` and `migrate_to_chat_id`.
- Validate request inputs strictly; tolerate additive response fields, enum
  values, and unknown Update variants.
- Model Telegram integers as Smithy longs and validated JavaScript safe-integer
  numbers.
- Expose file IDs, URLs, bytes, Effect byte streams, and platform-specific path
  helpers.

## Bot Application API

```ts
const Bot = Telegram.Bot(
  "Notifications",
  {
    token: Config.redacted("TELEGRAM_BOT_TOKEN"),
    profile: {
      default: { name, description, shortDescription },
      locales: { es: { name, description, shortDescription } },
    },
    menuButton,
    defaultAdministratorRights: { groups, channels },
  },
  Effect.gen(function*() {
    yield* Telegram.Command("link", options, handler)
    yield* Telegram.Hears(pattern, handler)
    yield* Telegram.CallbackQuery(pattern, options, handler)
    yield* Telegram.On("message", handler)
  })
)

const Routes = Telegram.Webhook(Bot, {
  origin: Cloudflare.Worker.URL,
  path: "/api/telegram/webhook",
})
```

`Bot` is a deterministic definition program. Planning receives only serializable
metadata; handler closures remain runtime code. Yielding a Bot returns:

- `api`: the Effect-native Distilled client.
- `identity`: Bot ID, username, and observable display data verified by `getMe`.
- `handle(update)`: direct typed Update dispatch for tests and non-HTTP callers.

## Handler semantics

- Handler Context is immutable and contains the narrowed Telegram value, raw
  Update, match data, API client, and Effect-returning conveniences.
- Effect Layers and services are the only dependency/extension mechanism. There
  is no separate middleware pipeline.
- Dispatch is exclusive: `Command`, `Hears`, and `CallbackQuery` precede one
  matching typed `On` fallback.
- Sequential declaration order resolves overlapping specialized patterns. Exact
  duplicates and duplicate paths fail definition.
- `On` uses Telegram Update field names and supports `"*"` as an unknown/raw
  fallback.
- Commands match `message` and `business_message` through Telegram's
  `bot_command` entity, including a matching `/command@botusername`; edited
  messages require explicit `On` registration.
- Commands expose raw arguments and may use a `Schema<A, string>` decoder. A
  decoder requires an invalid-arguments handler, whose response is acknowledged
  without retry.
- `Hears` accepts strings and regular expressions for message text.
- `CallbackQuery` auto-answers successfully handled queries unless disabled or
  explicitly answered by the handler.

## Webhook semantics

`Telegram.Webhook(Bot, { origin, path })` returns the complete Effect
`HttpRouter` route Layer. The caller must supply the public origin; the package
does no host discovery. `origin` may be an Alchemy Output such as
`Cloudflare.Worker.URL`.

- Generate one stable 32-byte `Alchemy.Random` secret per Webhook.
- Pass the redacted value to `setWebhook` and bind the same value to the host as
  secret text for request verification.
- Await handler completion.
- Return 200 after successful handling, 401 for invalid secret, 400 for invalid
  input, and 500 for handler failure.
- Do not drop pending updates on removal by default.
- Do not implement secret rotation in V1.
- Treat local state as sensitive; recommend an encrypted production state
  backend because Effect redaction is not state encryption.
- During local development with a local origin, register the route and bindings
  but skip remote `setWebhook`. Allow fixture POSTs. An explicit public origin or
  remotely deployed host enables Webhook reconciliation and must warn before it
  can displace an existing development/production Webhook.

## Provider lifecycle

- Use `getMe` to verify credentials and persist the authenticated Bot ID.
- Accept token rotation only when the Bot ID remains unchanged.
- Fail when credentials identify another Bot; require destruction using the old
  credential before explicit retargeting.
- Update all V1 configuration in place.
- Never-declared properties are unmanaged. Removing previously managed values
  resets them to Telegram defaults.
- Profile and Command Set declarations directly claim their slices.
- A non-empty Webhook pointing elsewhere is unowned and requires explicit
  Alchemy adoption.
- Compile Commands into complete Command Sets per Bot, scope, and language.
  Reject duplicates, replace sets atomically, delete stale owned sets, and use
  default descriptions for missing locale translations.
- Deleting the Bot Application resets owned profile text, Command Sets, menu
  button, administrator rights, and Webhook while leaving Bot identity and token
  untouched.
- V1 excludes profile photos, per-chat configuration, Sticker Sets, managed-bot
  creation, and polling runtime support.

## Verification and release

- Commit normalized and generated artifacts.
- Deterministic regeneration must produce a clean diff.
- Type-check handwritten code fully; scope any `noCheck` concession only to the
  generated SDK project.
- Test protocol fixtures, a fake HTTP server, multipart recursion, retries,
  response tolerance, and secret leakage.
- Test provider plan, deploy, update, drift, adoption, and destroy.
- Run secured scheduled/release live tests against a dedicated Bot.
- Provide examples for localization, all handler helpers, multiple Bots, local
  fixture delivery, explicit public origins, safe same-Bot token rotation, and
  foreign Webhook adoption.

