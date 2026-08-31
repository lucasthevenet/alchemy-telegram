import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Telegram from "distilled-telegram";
import type {
  BotCommandScope,
  CallbackQuery as TelegramCallbackQuery,
  ChatAdministratorRights,
  MenuButton,
  Message,
  Update,
} from "distilled-telegram";
import {
  CommandSet,
  DefaultAdministratorRightsConfig,
  MenuButtonConfig,
  Profile,
} from "./resources.ts";

export interface LocalizedProfile {
  readonly name?: string;
  readonly description?: string;
  readonly shortDescription?: string;
}

export interface BotOptions {
  readonly token:
    | string
    | Redacted.Redacted<string>
    | Config.Config<Redacted.Redacted<string>>;
  readonly apiOrigin?: string;
  readonly profile?: {
    readonly default?: LocalizedProfile;
    readonly locales?: Readonly<Record<string, LocalizedProfile>>;
  };
  readonly menuButton?: MenuButton;
  readonly defaultAdministratorRights?: {
    readonly groups?: ChatAdministratorRights;
    readonly channels?: ChatAdministratorRights;
  };
}

export interface HandlerContext<A = unknown> {
  readonly update: Update;
  readonly message?: Message;
  readonly callbackQuery?: TelegramCallbackQuery;
  readonly match?: RegExpMatchArray;
  readonly args: A;
  readonly api: typeof Telegram;
  readonly reply: (
    text: string,
    options?: Omit<Telegram.SendMessageRequest, "chat_id" | "text">,
  ) => Effect.Effect<
    Telegram.Message,
    Telegram.SendMessageError,
    Telegram.TelegramOpContext
  >;
  readonly answerCallbackQuery: (
    options?: Omit<Telegram.AnswerCallbackQueryRequest, "callback_query_id">,
  ) => Effect.Effect<
    boolean,
    Telegram.AnswerCallbackQueryError,
    Telegram.TelegramOpContext
  >;
}

export type Handler<A = unknown, E = unknown, R = never> = (
  context: HandlerContext<A>,
) => Effect.Effect<unknown, E, R>;

interface CommandOptionsBase {
  readonly description: string;
  readonly locales?: Readonly<Record<string, string>>;
  readonly scopes?: readonly BotCommandScope[];
}

export type CommandOptions<S extends Schema.Top | undefined = undefined> =
  CommandOptionsBase &
    ([S] extends [undefined]
      ? { readonly args?: undefined; readonly onInvalidArgs?: undefined }
      : {
          readonly args: S;
          readonly onInvalidArgs: (
            context: HandlerContext<unknown>,
            error: Schema.SchemaError,
          ) => Effect.Effect<unknown, unknown, unknown>;
        });

type RegisteredCommandOptions = CommandOptionsBase & {
  readonly args?: Schema.Top;
  readonly onInvalidArgs?: (
    context: HandlerContext<unknown>,
    error: Schema.SchemaError,
  ) => Effect.Effect<unknown, unknown, unknown>;
};

export interface MatchOptions {
  readonly autoAnswer?: boolean;
}

type SpecializedHandler =
  | {
      readonly kind: "command";
      readonly key: string;
      readonly command: string;
      readonly options: RegisteredCommandOptions;
      readonly handler: Handler<any, any, any>;
    }
  | {
      readonly kind: "hears";
      readonly key: string;
      readonly pattern: string | RegExp;
      readonly handler: Handler<unknown, any, any>;
    }
  | {
      readonly kind: "callback_query";
      readonly key: string;
      readonly pattern: string | RegExp;
      readonly options: MatchOptions;
      readonly handler: Handler<unknown, any, any>;
    };

type FallbackHandler = {
  readonly kind: "on";
  readonly key: string;
  readonly event: keyof Update | "*";
  readonly handler: Handler<unknown, any, any>;
};

export interface CommandDeclaration {
  readonly command: string;
  readonly options: RegisteredCommandOptions;
}

interface BuilderState {
  readonly specialized: SpecializedHandler[];
  readonly fallback: FallbackHandler[];
  readonly keys: Set<string>;
  readonly commands: CommandDeclaration[];
}

class Builder extends Context.Service<Builder, BuilderState>()(
  "alchemy-telegram/Builder",
) {}

const patternKey = (pattern: string | RegExp): string =>
  Predicate.isString(pattern)
    ? `string:${pattern}`
    : `regexp:${pattern.source}/${pattern.flags}`;

const register = (
  key: string,
  append: (state: BuilderState) => void,
): Effect.Effect<void, never, Builder> =>
  Effect.gen(function* () {
    const state = yield* Builder;
    if (state.keys.has(key)) {
      return yield* Effect.die(new Error(`Duplicate Telegram handler: ${key}`));
    }
    state.keys.add(key);
    append(state);
  });

export const Command = <
  S extends Schema.Top | undefined = undefined,
  E = unknown,
  R = never,
>(
  command: string,
  options: CommandOptions<S>,
  handler: Handler<S extends Schema.Top ? Schema.Schema.Type<S> : string, E, R>,
): Effect.Effect<void, never, Builder> => {
  const normalized = command.replace(/^\//, "").toLowerCase();
  return register(`command:${normalized}`, (state) => {
    state.specialized.push({
      kind: "command",
      key: `command:${normalized}`,
      command: normalized,
      options,
      handler,
    });
    state.commands.push({ command: normalized, options });
  });
};

export const Hears = <E, R>(
  pattern: string | RegExp,
  handler: Handler<unknown, E, R>,
): Effect.Effect<void, never, Builder> =>
  register(`hears:${patternKey(pattern)}`, (state) => {
    state.specialized.push({
      kind: "hears",
      key: `hears:${patternKey(pattern)}`,
      pattern,
      handler,
    });
  });

export const CallbackQuery = <E, R>(
  pattern: string | RegExp,
  options: MatchOptions | Handler<unknown, E, R>,
  handler?: Handler<unknown, E, R>,
): Effect.Effect<void, never, Builder> => {
  const handlerOnly = Predicate.isFunction(options);
  const actualOptions = handlerOnly ? {} : options;
  const actualHandler = handlerOnly ? options : handler;
  if (!actualHandler) {
    return Effect.die(new Error("Telegram.CallbackQuery requires a handler"));
  }
  return register(`callback:${patternKey(pattern)}`, (state) => {
    state.specialized.push({
      kind: "callback_query",
      key: `callback:${patternKey(pattern)}`,
      pattern,
      options: actualOptions,
      handler: actualHandler,
    });
  });
};

export const On = <E, R>(
  event: keyof Update | "*",
  handler: Handler<unknown, E, R>,
): Effect.Effect<void, never, Builder> =>
  register(`on:${String(event)}`, (state) => {
    state.fallback.push({
      kind: "on",
      key: `on:${String(event)}`,
      event,
      handler,
    });
  });

const matches = (
  pattern: string | RegExp,
  value: string,
): RegExpMatchArray | undefined => {
  if (Predicate.isString(pattern)) {
    return value === pattern
      ? (value.match(/^[\s\S]*$/) ?? undefined)
      : undefined;
  }
  pattern.lastIndex = 0;
  return value.match(pattern) ?? undefined;
};

const messageOf = (update: Update): Message | undefined =>
  update.message ?? update.business_message;

const commandOf = (
  message: Message | undefined,
): { readonly name: string; readonly args: string } | undefined => {
  if (!message?.text || !message.entities) return undefined;
  const entity = message.entities.find(
    (candidate) => candidate.type === "bot_command" && candidate.offset === 0,
  );
  if (!entity) return undefined;
  const token = message.text.slice(0, entity.length);
  const name = token.slice(1).split("@", 1)[0]?.toLowerCase();
  if (!name) return undefined;
  return { name, args: message.text.slice(entity.length).trim() };
};

const updateEvent = (update: Update): string | undefined =>
  Object.entries(update).find(
    ([key, value]) => key !== "update_id" && value !== undefined,
  )?.[0];

const stableId = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const profileValue = (profile: LocalizedProfile) => ({
  name: profile.name,
  description: profile.description,
  short_description: profile.shortDescription,
});

const declareProfile = Effect.fn(function* (
  name: string,
  options: NonNullable<BotOptions["profile"]>,
  token: Redacted.Redacted<string>,
  apiOrigin: string | undefined,
) {
  yield* Profile(`${name}Profile`, {
    token,
    apiOrigin,
    default: options.default ? profileValue(options.default) : undefined,
    locales: options.locales
      ? Object.fromEntries(
          Object.entries(options.locales).map(([locale, profile]) => [
            locale,
            profileValue(profile),
          ]),
        )
      : undefined,
  });
});

const declareCommandSets = Effect.fn(function* (
  name: string,
  declarations: readonly CommandDeclaration[],
  token: Redacted.Redacted<string>,
  apiOrigin: string | undefined,
) {
  const scoped = new Map<
    string,
    {
      readonly scope: BotCommandScope;
      readonly commands: CommandDeclaration[];
    }
  >();
  for (const declaration of declarations) {
    for (const scope of declaration.options.scopes ?? [{ type: "default" }]) {
      const key = JSON.stringify(scope);
      const group = scoped.get(key) ?? { scope, commands: [] };
      group.commands.push(declaration);
      scoped.set(key, group);
    }
  }
  for (const [scopeKey, group] of scoped) {
    const locales = new Set<string>([""]);
    for (const declaration of group.commands) {
      for (const locale of Object.keys(declaration.options.locales ?? {})) {
        locales.add(locale);
      }
    }
    for (const locale of locales) {
      const commands = group.commands.map((declaration) => ({
        command: declaration.command,
        description:
          (locale ? declaration.options.locales?.[locale] : undefined) ??
          declaration.options.description,
      }));
      const key = `${scopeKey}:${locale}`;
      yield* CommandSet(`${name}Commands${stableId(key)}`, {
        token,
        apiOrigin,
        commands,
        scope: group.scope,
        language_code: locale || undefined,
      });
    }
  }
});

const declareBotResources = Effect.fn(function* (
  name: string,
  options: BotOptions,
  token: Redacted.Redacted<string>,
  commands: readonly CommandDeclaration[],
) {
  if (options.profile) {
    yield* declareProfile(name, options.profile, token, options.apiOrigin);
  }
  yield* declareCommandSets(name, commands, token, options.apiOrigin);
  if (options.menuButton) {
    yield* MenuButtonConfig(`${name}MenuButton`, {
      token,
      apiOrigin: options.apiOrigin,
      menu_button: options.menuButton,
    });
  }
  if (options.defaultAdministratorRights) {
    yield* DefaultAdministratorRightsConfig(`${name}AdministratorRights`, {
      token,
      apiOrigin: options.apiOrigin,
      groups: options.defaultAdministratorRights.groups,
      channels: options.defaultAdministratorRights.channels,
    });
  }
});

export interface BotApplication {
  readonly name: string;
  readonly options: BotOptions;
  readonly token: Redacted.Redacted<string>;
  readonly commands: readonly CommandDeclaration[];
  readonly api: typeof Telegram;
  readonly identity: Effect.Effect<Telegram.User, Telegram.GetMeError, never>;
  readonly dispatch: (update: Update) => Effect.Effect<void, unknown, unknown>;
  readonly handle: (update: Update) => Effect.Effect<void, unknown, unknown>;
}

type BotResourceProviders =
  | typeof Profile.Provider
  | typeof CommandSet.Provider
  | typeof MenuButtonConfig.Provider
  | typeof DefaultAdministratorRightsConfig.Provider;

type BotRequirements<R, ManageResources extends boolean | undefined> =
  | Exclude<R, Builder>
  | (ManageResources extends false ? never : BotResourceProviders);

const makeContext = <A>(
  update: Update,
  args: A,
  match?: RegExpMatchArray,
  callbackState?: { answered: boolean },
): HandlerContext<A> => {
  const message = messageOf(update);
  return {
    update,
    message,
    callbackQuery: update.callback_query,
    match,
    args,
    api: Telegram,
    reply: (text, options = {}) => {
      if (!message) {
        return Effect.die(
          new Error("Telegram.reply requires a message update"),
        );
      }
      return Telegram.sendMessage({
        chat_id: message.chat.id,
        text,
        ...options,
      });
    },
    answerCallbackQuery: (options = {}) => {
      const query = update.callback_query;
      if (!query) {
        return Effect.die(
          new Error(
            "Telegram.answerCallbackQuery requires a callback query update",
          ),
        );
      }
      return Effect.flatMap(
        Effect.sync(() => {
          if (callbackState) callbackState.answered = true;
        }),
        () =>
          Telegram.answerCallbackQuery({
            callback_query_id: query.id,
            ...options,
          }),
      );
    },
  };
};

export const Bot = <
  E,
  R,
  ManageResources extends boolean | undefined = undefined,
>(
  name: string,
  options: BotOptions,
  declarations: Effect.Effect<unknown, E, Builder | R>,
  /** @internal Used by the runtime unit tests; applications should omit this. */
  internal?: { readonly manageResources?: ManageResources },
): Effect.Effect<
  BotApplication,
  E | Config.ConfigError,
  BotRequirements<R, ManageResources>
> =>
  // SAFETY: providing Builder removes it from the declaration environment;
  // the runtime branch registers resources exactly when the conditional
  // BotRequirements type includes their provider services.
  Effect.gen(function* () {
    const manageResources =
      internal?.manageResources !== false && !globalThis.__ALCHEMY_RUNTIME__;
    const token = Config.isConfig(options.token)
      ? yield* options.token
      : Redacted.isRedacted(options.token)
        ? options.token
        : Redacted.make(options.token);
    const state: BuilderState = {
      specialized: [],
      fallback: [],
      keys: new Set(),
      commands: [],
    };
    yield* declarations.pipe(Effect.provideService(Builder, state));
    if (manageResources) {
      yield* declareBotResources(name, options, token, state.commands);
    }
    const runtime = Layer.mergeAll(
      Telegram.credentials({ token, apiOrigin: options.apiOrigin }),
      FetchHttpClient.layer,
    );
    const runHandler = (effect: Effect.Effect<unknown, unknown, unknown>) =>
      effect.pipe(Effect.provide(runtime));
    const dispatch = (update: Update): Effect.Effect<void, unknown, unknown> =>
      Effect.gen(function* () {
        const message = messageOf(update);
        const command = commandOf(message);
        for (const declaration of state.specialized) {
          if (declaration.kind === "command") {
            if (command?.name !== declaration.command) continue;
            let args: unknown = command.args;
            if (declaration.options.args) {
              const parsed = yield* Schema.decodeUnknownEffect(
                declaration.options.args,
              )(command.args).pipe(Effect.result);
              if (parsed._tag === "Failure") {
                const invalidArguments = declaration.options.onInvalidArgs;
                if (!invalidArguments) {
                  return yield* Effect.die(
                    new Error(
                      `Telegram command ${declaration.command} has an argument schema without an invalid-arguments handler`,
                    ),
                  );
                }
                yield* runHandler(
                  invalidArguments(
                    makeContext(update, undefined),
                    parsed.failure,
                  ),
                );
                return;
              }
              args = parsed.success;
            }
            yield* runHandler(declaration.handler(makeContext(update, args)));
            return;
          }
          if (declaration.kind === "hears") {
            if (!message?.text) continue;
            const match = matches(declaration.pattern, message.text);
            if (!match) continue;
            yield* runHandler(
              declaration.handler(makeContext(update, undefined, match)),
            );
            return;
          }
          const query = update.callback_query;
          if (!query?.data) continue;
          const match = matches(declaration.pattern, query.data);
          if (!match) continue;
          const callbackState = { answered: false };
          yield* runHandler(
            declaration.handler(
              makeContext(update, undefined, match, callbackState),
            ),
          );
          if (
            declaration.options.autoAnswer !== false &&
            !callbackState.answered
          ) {
            yield* runHandler(
              Telegram.answerCallbackQuery({ callback_query_id: query.id }),
            );
          }
          return;
        }
        const event = updateEvent(update);
        const fallback = state.fallback.find(
          (declaration) =>
            declaration.event === event || declaration.event === "*",
        );
        if (fallback) {
          yield* runHandler(fallback.handler(makeContext(update, undefined)));
        }
      });
    const identity = Telegram.getMe({}).pipe(Effect.provide(runtime));
    return {
      name,
      options,
      token,
      commands: state.commands,
      api: Telegram,
      identity,
      dispatch,
      handle: dispatch,
    };
  }) as Effect.Effect<
    BotApplication,
    E | Config.ConfigError,
    BotRequirements<R, ManageResources>
  >;
