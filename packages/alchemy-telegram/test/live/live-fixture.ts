import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Api from "distilled-telegram";

const runtime = Layer.mergeAll(Api.CredentialsFromEnv, FetchHttpClient.layer);

const restoreDefaultCommands = (commands: readonly Api.BotCommand[]) =>
  (commands.length === 0
    ? Api.deleteMyCommands({})
    : Api.setMyCommands({ commands: [...commands] })
  ).pipe(Effect.provide(runtime), Effect.orDie);

/** Run a live mutation while guaranteeing restoration of the default Command Set. */
export const withRestoredDefaultCommands = <A, E, R>(
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Api.GetMyCommandsError, R> =>
  Effect.acquireUseRelease(
    Api.getMyCommands({}).pipe(Effect.provide(runtime)),
    () => use,
    restoreDefaultCommands,
  );
