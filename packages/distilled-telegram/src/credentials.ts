/** Per-call Telegram Bot API credentials. */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

export const DEFAULT_API_ORIGIN = "https://api.telegram.org";

export interface Config {
  readonly token: Redacted.Redacted<string>;
  readonly apiOrigin: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("TelegramCredentials") {}

const envConfig = EffectConfig.all({
  token: EffectConfig.string("TELEGRAM_BOT_TOKEN"),
  apiOrigin: EffectConfig.string("TELEGRAM_API_ORIGIN").pipe(
    EffectConfig.withDefault(DEFAULT_API_ORIGIN),
  ),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message: "TELEGRAM_BOT_TOKEN environment variable is required",
        }),
    ),
    Effect.map(({ token, apiOrigin }) => ({
      token: Redacted.make(token),
      apiOrigin,
    })),
    Effect.orDie,
  ),
);

export const credentials = (config: {
  readonly token: string | Redacted.Redacted<string>;
  readonly apiOrigin?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      token: Redacted.isRedacted(config.token)
        ? config.token
        : Redacted.make(config.token),
      apiOrigin: config.apiOrigin ?? DEFAULT_API_ORIGIN,
    }),
  );
