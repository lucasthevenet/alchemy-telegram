/** Telegram retries are opt-in: the default policy never repeats a method. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Retries from "@distilled.cloud/core/retry";

export type Options = Retries.Options;
export type Factory = Retries.Factory;
export type Policy = Retries.Policy;

export class Retry extends Context.Service<Retry, Policy>()("TelegramRetry") {}

export const makeDefault: Factory = () => ({ while: () => false });

export const policy =
  (value: Policy) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, Retry>> =>
    effect.pipe(Effect.provide(Layer.succeed(Retry, value)));

export const none = policy(makeDefault);
