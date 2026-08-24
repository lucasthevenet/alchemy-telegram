# Compile Commands into owned Command Sets

Keep `Telegram.Command` as the per-command authoring and runtime-dispatch unit,
but compile declarations into complete Command Sets keyed by Bot, scope, and
language for provider reconciliation. Reject overlapping duplicate Commands,
replace each owned set atomically, and delete previously owned sets that are no
longer declared because Telegram's API replaces commands at Command Set
granularity. When a locale omits a translation for a Command, use that Command's
default description so every localized Command Set remains complete. Commands
match original and business messages through Telegram's `bot_command` entity;
optional argument Schemas decode the raw remainder and require an explicit
invalid-arguments handler whose response is acknowledged without retry.
