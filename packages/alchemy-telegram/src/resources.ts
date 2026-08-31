import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  RandomProvider,
  Resource,
  type Input,
  type Resource as AlchemyResource,
} from "alchemy";
import { Unowned } from "alchemy/AdoptPolicy";
import * as Provider from "alchemy/Provider";
import * as Telegram from "distilled-telegram";
import type {
  BotCommand,
  BotCommandScope,
  ChatAdministratorRights,
  MenuButton,
} from "distilled-telegram";

interface AuthProps {
  readonly token: Redacted.Redacted<string>;
  readonly apiOrigin?: string;
}

export interface ProfileValue {
  readonly name?: string;
  readonly description?: string;
  readonly short_description?: string;
}

export interface ProfileProps extends AuthProps {
  readonly default?: ProfileValue;
  readonly locales?: Readonly<Record<string, ProfileValue>>;
}

export interface ProfileAttributes {
  readonly bot_id: number;
  readonly profile: Readonly<Record<string, ProfileValue>>;
}

export type Profile = AlchemyResource<
  "Telegram.Bot.Profile",
  ProfileProps,
  ProfileAttributes
>;
export const Profile = Resource<Profile>("Telegram.Bot.Profile");

export interface CommandSetProps extends AuthProps {
  readonly commands: readonly BotCommand[];
  readonly scope?: BotCommandScope;
  readonly language_code?: string;
}
export interface CommandSetAttributes {
  readonly bot_id: number;
  readonly commands: readonly BotCommand[];
  readonly scope?: BotCommandScope;
  readonly language_code?: string;
}
export type CommandSet = AlchemyResource<
  "Telegram.Bot.CommandSet",
  CommandSetProps,
  CommandSetAttributes
>;
export const CommandSet = Resource<CommandSet>("Telegram.Bot.CommandSet");

export interface WebhookProps extends AuthProps {
  /** URL that Telegram will POST updates to. */
  readonly url: Input<string>;
  /** Optional token copied into Telegram's webhook secret header. */
  readonly secretToken?: Redacted.Redacted<string>;
  /** Telegram Update events to deliver. Omitting this uses Telegram's default. */
  readonly events?: readonly string[];
  /** Ask Telegram to discard queued updates during this reconciliation. */
  readonly dropPendingUpdates?: boolean;
}
export interface WebhookAttributes {
  readonly bot_id: number;
  readonly url: string;
  readonly allowed_updates?: readonly string[];
}
export type Webhook = AlchemyResource<
  "Telegram.Bot.Webhook",
  WebhookProps,
  WebhookAttributes
>;

/**
 * A Telegram Bot webhook registration.
 *
 * This resource owns Telegram's singleton webhook configuration for the Bot
 * identified by `token`. It accepts deferred Alchemy inputs for `url`, updates
 * the registration in place, repairs out-of-band deletion, and unregisters an
 * owned URL when destroyed.
 *
 * Use {@link consumeEvents} when a host adapter should also provision the
 * delivery URL, verify requests, and dispatch updates to a Bot Application.
 *
 * @resource
 */
export const Webhook = Resource<Webhook>("Telegram.Bot.Webhook");

/** @deprecated Use {@link Webhook}. */
export type WebhookConfig = Webhook;
/** @deprecated Use {@link Webhook}. */
export const WebhookConfig = Webhook;

export interface MenuButtonProps extends AuthProps {
  readonly menu_button: MenuButton;
}
export interface MenuButtonAttributes {
  readonly bot_id: number;
  readonly menu_button: MenuButton;
}
export type MenuButtonConfig = AlchemyResource<
  "Telegram.Bot.MenuButton",
  MenuButtonProps,
  MenuButtonAttributes
>;
export const MenuButtonConfig = Resource<MenuButtonConfig>(
  "Telegram.Bot.MenuButton",
);

export interface DefaultAdministratorRightsProps extends AuthProps {
  readonly groups?: ChatAdministratorRights;
  readonly channels?: ChatAdministratorRights;
}
export interface DefaultAdministratorRightsAttributes {
  readonly bot_id: number;
  readonly groups?: ChatAdministratorRights;
  readonly channels?: ChatAdministratorRights;
}
export type DefaultAdministratorRightsConfig = AlchemyResource<
  "Telegram.Bot.DefaultAdministratorRights",
  DefaultAdministratorRightsProps,
  DefaultAdministratorRightsAttributes
>;
export const DefaultAdministratorRightsConfig =
  Resource<DefaultAdministratorRightsConfig>(
    "Telegram.Bot.DefaultAdministratorRights",
  );

export class BotIdentityMismatch extends Data.TaggedError(
  "BotIdentityMismatch",
)<{
  readonly expected: number;
  readonly actual: number;
  readonly message: string;
}> {}

const runtime = (props: AuthProps) =>
  Layer.mergeAll(
    Telegram.credentials({ token: props.token, apiOrigin: props.apiOrigin }),
    FetchHttpClient.layer,
  );

const call = <A, E>(
  props: AuthProps,
  effect: Effect.Effect<A, E, Telegram.TelegramOpContext>,
): Effect.Effect<A, E> => effect.pipe(Effect.provide(runtime(props)));

const identify = (
  props: AuthProps,
  expected?: number,
): Effect.Effect<
  Telegram.User,
  Telegram.TelegramOpError | BotIdentityMismatch
> =>
  Effect.gen(function* () {
    const user = yield* call(props, Telegram.getMe({}));
    if (expected !== undefined && expected !== user.id) {
      return yield* Effect.fail(
        new BotIdentityMismatch({
          expected,
          actual: user.id,
          message:
            `Telegram token identifies bot ${user.id}, but this resource belongs to bot ${expected}. ` +
            "Destroy the old resource before changing to a different bot.",
        }),
      );
    }
    return user;
  });

const same = <A>(left: A, right: A): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const profileMap = (props: ProfileProps) => {
  const profile = { ...props.locales };
  if (props.default) profile[""] = props.default;
  return profile;
};

type MutableProfileValue = {
  -readonly [Key in keyof ProfileValue]: ProfileValue[Key];
};

const observeProfile = (props: ProfileProps, languages: readonly string[]) =>
  Effect.gen(function* () {
    const result: Record<string, ProfileValue> = {};
    for (const language_code of languages) {
      const request = language_code ? { language_code } : {};
      const [name, description, short] = yield* Effect.all([
        call(props, Telegram.getMyName(request)),
        call(props, Telegram.getMyDescription(request)),
        call(props, Telegram.getMyShortDescription(request)),
      ]);
      const profile: MutableProfileValue = {};
      if (name.name) profile.name = name.name;
      if (description.description)
        profile.description = description.description;
      if (short.short_description) {
        profile.short_description = short.short_description;
      }
      result[language_code] = profile;
    }
    return result;
  });

const reconcileProfileName = Effect.fn(function* (
  props: ProfileProps,
  language_code: string,
  desired: ProfileValue,
  previous: ProfileValue,
  observed: ProfileValue,
) {
  const language = language_code ? { language_code } : {};
  if (desired.name !== undefined && desired.name !== observed.name) {
    yield* call(props, Telegram.setMyName({ ...language, name: desired.name }));
  } else if (
    language_code &&
    desired.name === undefined &&
    previous.name !== undefined
  ) {
    yield* call(props, Telegram.setMyName({ ...language, name: "" }));
  }
});

export const ProfileProvider = () =>
  Provider.succeed(Profile, {
    nuke: { singleton: true },
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      const languages = Object.keys(profileMap(olds));
      return {
        bot_id: user.id,
        profile: yield* observeProfile(olds, languages),
      };
    }),
    reconcile: Effect.fn(function* ({ news, olds, output }) {
      const user = yield* identify(news, output?.bot_id);
      const desired = profileMap(news);
      const previous = olds ? profileMap(olds) : {};
      const languages = [
        ...new Set([...Object.keys(desired), ...Object.keys(previous)]),
      ];
      const observed = yield* observeProfile(news, languages);
      for (const language_code of languages) {
        const locale = desired[language_code] ?? {};
        const old = previous[language_code] ?? {};
        const live = observed[language_code] ?? {};
        const language = language_code ? { language_code } : {};
        yield* reconcileProfileName(news, language_code, locale, old, live);
        if (
          locale.description !== undefined &&
          locale.description !== live.description
        ) {
          yield* call(
            news,
            Telegram.setMyDescription({
              ...language,
              description: locale.description,
            }),
          );
        } else if (
          locale.description === undefined &&
          old.description !== undefined
        ) {
          yield* call(
            news,
            Telegram.setMyDescription({ ...language, description: "" }),
          );
        }
        if (
          locale.short_description !== undefined &&
          locale.short_description !== live.short_description
        ) {
          yield* call(
            news,
            Telegram.setMyShortDescription({
              ...language,
              short_description: locale.short_description,
            }),
          );
        } else if (
          locale.short_description === undefined &&
          old.short_description !== undefined
        ) {
          yield* call(
            news,
            Telegram.setMyShortDescription({
              ...language,
              short_description: "",
            }),
          );
        }
      }
      return { bot_id: user.id, profile: desired };
    }),
    delete: Effect.fn(function* ({ olds, output }) {
      yield* identify(olds, output.bot_id);
      for (const [language_code, locale] of Object.entries(profileMap(olds))) {
        const language = language_code ? { language_code } : {};
        // Telegram does not permit clearing the irreducible default Bot name.
        // An empty name only removes a localized override.
        if (language_code && locale.name !== undefined) {
          yield* call(olds, Telegram.setMyName({ ...language, name: "" }));
        }
        if (locale.description !== undefined) {
          yield* call(
            olds,
            Telegram.setMyDescription({ ...language, description: "" }),
          );
        }
        if (locale.short_description !== undefined) {
          yield* call(
            olds,
            Telegram.setMyShortDescription({
              ...language,
              short_description: "",
            }),
          );
        }
      }
    }),
  });

export const CommandSetProvider = () =>
  Provider.succeed(CommandSet, {
    nuke: { singleton: true },
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      const commands = yield* call(
        olds,
        Telegram.getMyCommands({
          scope: olds.scope,
          language_code: olds.language_code,
        }),
      );
      return {
        bot_id: user.id,
        commands,
        scope: olds.scope,
        language_code: olds.language_code,
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const user = yield* identify(news, output?.bot_id);
      const observed = yield* call(
        news,
        Telegram.getMyCommands({
          scope: news.scope,
          language_code: news.language_code,
        }),
      );
      if (!same(observed, news.commands)) {
        yield* call(
          news,
          Telegram.setMyCommands({
            commands: [...news.commands],
            scope: news.scope,
            language_code: news.language_code,
          }),
        );
      }
      return {
        bot_id: user.id,
        commands: news.commands,
        scope: news.scope,
        language_code: news.language_code,
      };
    }),
    delete: ({ olds, output }) =>
      Effect.gen(function* () {
        yield* identify(olds, output.bot_id);
        yield* call(
          olds,
          Telegram.deleteMyCommands({
            scope: olds.scope,
            language_code: olds.language_code,
          }),
        );
      }),
  });

const isLocalUrl = (url: string): boolean => {
  const hostname = new URL(url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
};

const resolvedWebhookUrl = (url: Input<string>): string => {
  if (Predicate.isString(url)) return url;
  throw new TypeError(
    "Telegram webhook URL reached its provider before Alchemy resolved it",
  );
};

export const WebhookProvider = () =>
  Provider.succeed(Webhook, {
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      const desiredUrl = resolvedWebhookUrl(olds.url);
      if (isLocalUrl(desiredUrl)) return output;
      const info = yield* call(olds, Telegram.getWebhookInfo({}));
      if (!info.url) return undefined;
      const attrs = {
        bot_id: user.id,
        url: info.url,
        allowed_updates: info.allowed_updates,
      };
      return output ? attrs : Unowned(attrs);
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const user = yield* identify(news, output?.bot_id);
      const url = resolvedWebhookUrl(news.url);
      if (!isLocalUrl(url)) {
        yield* call(
          news,
          Telegram.setWebhook({
            url,
            secret_token: news.secretToken
              ? Redacted.value(news.secretToken)
              : undefined,
            allowed_updates: news.events ? [...news.events] : undefined,
            drop_pending_updates: news.dropPendingUpdates,
          }),
        );
      }
      return {
        bot_id: user.id,
        url,
        allowed_updates: news.events,
      };
    }),
    delete: Effect.fn(function* ({ olds, output }) {
      yield* identify(olds, output.bot_id);
      const ownedUrl = resolvedWebhookUrl(olds.url);
      if (isLocalUrl(ownedUrl)) return;
      const observed = yield* call(olds, Telegram.getWebhookInfo({}));
      if (observed.url !== ownedUrl) return;
      yield* call(olds, Telegram.deleteWebhook({}));
    }),
  });

export const MenuButtonProvider = () =>
  Provider.succeed(MenuButtonConfig, {
    nuke: { singleton: true },
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      return {
        bot_id: user.id,
        menu_button: yield* call(olds, Telegram.getChatMenuButton({})),
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const user = yield* identify(news, output?.bot_id);
      const observed = yield* call(news, Telegram.getChatMenuButton({}));
      if (!same(observed, news.menu_button)) {
        yield* call(
          news,
          Telegram.setChatMenuButton({ menu_button: news.menu_button }),
        );
      }
      return { bot_id: user.id, menu_button: news.menu_button };
    }),
    delete: Effect.fn(function* ({ olds, output }) {
      yield* identify(olds, output.bot_id);
      yield* call(
        olds,
        Telegram.setChatMenuButton({ menu_button: { type: "default" } }),
      );
    }),
  });

export const DefaultAdministratorRightsProvider = () =>
  Provider.succeed(DefaultAdministratorRightsConfig, {
    nuke: { singleton: true },
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      const [groups, channels] = yield* Effect.all([
        call(
          olds,
          Telegram.getMyDefaultAdministratorRights({ for_channels: false }),
        ),
        call(
          olds,
          Telegram.getMyDefaultAdministratorRights({ for_channels: true }),
        ),
      ]);
      return { bot_id: user.id, groups, channels };
    }),
    reconcile: Effect.fn(function* ({ news, olds, output }) {
      const user = yield* identify(news, output?.bot_id);
      const [groups, channels] = yield* Effect.all([
        call(
          news,
          Telegram.getMyDefaultAdministratorRights({ for_channels: false }),
        ),
        call(
          news,
          Telegram.getMyDefaultAdministratorRights({ for_channels: true }),
        ),
      ]);
      if (news.groups !== undefined && !same(groups, news.groups)) {
        yield* call(
          news,
          Telegram.setMyDefaultAdministratorRights({
            rights: news.groups,
            for_channels: false,
          }),
        );
      }
      if (news.channels !== undefined && !same(channels, news.channels)) {
        yield* call(
          news,
          Telegram.setMyDefaultAdministratorRights({
            rights: news.channels,
            for_channels: true,
          }),
        );
      }
      if (olds?.groups !== undefined && news.groups === undefined) {
        yield* call(
          news,
          Telegram.setMyDefaultAdministratorRights({ for_channels: false }),
        );
      }
      if (olds?.channels !== undefined && news.channels === undefined) {
        yield* call(
          news,
          Telegram.setMyDefaultAdministratorRights({ for_channels: true }),
        );
      }
      return { bot_id: user.id, groups: news.groups, channels: news.channels };
    }),
    delete: Effect.fn(function* ({ olds, output }) {
      yield* identify(olds, output.bot_id);
      if (olds.groups !== undefined) {
        yield* call(
          olds,
          Telegram.setMyDefaultAdministratorRights({ for_channels: false }),
        );
      }
      if (olds.channels !== undefined) {
        yield* call(
          olds,
          Telegram.setMyDefaultAdministratorRights({ for_channels: true }),
        );
      }
    }),
  });

/** All providers required by an Alchemy stack using Telegram resources. */
export const providers = () =>
  Layer.mergeAll(
    RandomProvider(),
    ProfileProvider(),
    CommandSetProvider(),
    WebhookProvider(),
    MenuButtonProvider(),
    DefaultAdministratorRightsProvider(),
  );
