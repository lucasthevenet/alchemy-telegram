/** Typed failures surfaced by Telegram operations. */
export { ConfigError } from "@distilled.cloud/core/errors";
import type { ConfigError } from "@distilled.cloud/core/errors";
import * as Category from "@distilled.cloud/core/category";
import * as Schema from "effect/Schema";

export class TelegramApiError extends Schema.TaggedError<TelegramApiError>()(
  "TelegramApiError",
  {
    error_code: Schema.Number,
    description: Schema.String,
    parameters: Schema.optional(Schema.Unknown),
  },
).pipe(Category.withBadRequestError) {}

export class TelegramRequestError extends Schema.TaggedError<TelegramRequestError>()(
  "TelegramRequestError",
  { message: Schema.String, cause: Schema.Unknown },
).pipe(Category.withBadRequestError) {}

export class TelegramDecodeError extends Schema.TaggedError<TelegramDecodeError>()(
  "TelegramDecodeError",
  { message: Schema.String, body: Schema.Unknown, cause: Schema.Unknown },
).pipe(Category.withParseError) {}

export class TelegramTransportError extends Schema.TaggedError<TelegramTransportError>()(
  "TelegramTransportError",
  { message: Schema.String, cause: Schema.Unknown },
).pipe(Category.withNetworkError, Category.withRetryable()) {}

export class UnknownTelegramError extends Schema.TaggedError<UnknownTelegramError>()(
  "UnknownTelegramError",
  { message: Schema.String, status: Schema.Number, body: Schema.Unknown },
).pipe(Category.withServerError) {}

export type TelegramClientError =
  | TelegramApiError
  | TelegramRequestError
  | TelegramDecodeError
  | TelegramTransportError
  | UnknownTelegramError;

export type DefaultErrors = ConfigError | TelegramClientError;
