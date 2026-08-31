# Alchemy Telegram

Alchemy Telegram declaratively manages Telegram Bot API configuration for bot
identities that already exist in Telegram.

## Language

**Bot**:
A Telegram bot identity created outside this provider and authenticated by a bot
token. The provider does not own the identity's creation or deletion.
_Avoid_: Bot resource, managed bot

**Bot Configuration**:
The Bot API settings that Alchemy declaratively manages for a Bot.
_Avoid_: Bot creation, bot lifecycle

**Bot Application**:
An executable Effect program attached to a Bot that combines desired Bot
Configuration with runtime Telegram update handling. The public constructor is
`Telegram.Bot`, but the construct does not create or delete the Bot identity.
_Avoid_: Bot resource, managed bot

**Command**:
A declaration that pairs Telegram command-menu metadata with the runtime handler
for matching updates. Commands are authoring units, not independently owned
remote objects.
_Avoid_: Command resource

**Command Set**:
The complete command menu owned for one Bot, command scope, and language. A Bot
Application compiles its Commands into Command Sets for reconciliation.
_Avoid_: Command list, individual command resource

**Webhook**:
The singleton Bot API registration that tells Telegram where and how to deliver
updates for one Bot. It is independently manageable Bot Configuration and does
not imply any particular HTTP runtime.
_Avoid_: Webhook Route, Webhook server, polling

**Bot Event Source**:
The host-neutral seam through which a Bot Application consumes Telegram
Webhook deliveries. The public service is `BotEventSource`; a host adapter
provisions the Webhook, binds its secret, claims the delivery path, verifies and
decodes each Update, and awaits the Bot Application's Update Handler. The first
adapter is `TelegramCloudflare.BotEventSourceLive` for Cloudflare Workers.
_Avoid_: Webhook Route, Webhook resource, Bot fetch handler

**Update Handler**:
An Effect program registered for a typed Telegram Update variant. A Command is
a specialized Update Handler that also contributes command-menu metadata.
_Avoid_: Event listener, middleware

**Handler Context**:
The immutable, typed view of one dispatched Update, including its narrowed
Telegram data, match information, Bot API client, and Effect-returning
conveniences.
_Avoid_: Mutable context, middleware context

**Bot Profile**:
The localized name, description, and short description managed for a Bot.
_Avoid_: Bot identity, account profile
