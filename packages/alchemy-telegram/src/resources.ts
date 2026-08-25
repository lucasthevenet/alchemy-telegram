import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  RandomProvider,
  Resource,
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
  readonly url: string;
  readonly secret_token: Redacted.Redacted<string>;
  readonly allowed_updates?: readonly string[];
  readonly drop_pending_updates?: boolean;
}
export interface WebhookAttributes {
  readonly bot_id: number;
  readonly url: string;
  readonly allowed_updates?: readonly string[];
}
export type WebhookConfig = AlchemyResource<
  "Telegram.Bot.Webhook",
  WebhookProps,
  WebhookAttributes
>;
export const WebhookConfig = Resource<WebhookConfig>("Telegram.Bot.Webhook");

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

const call = <A, E, R>(props: AuthProps, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(runtime(props))) as Effect.Effect<A, E, never>;

const identify = (
  props: AuthProps,
  expected?: number,
): Effect.Effect<Telegram.User, Telegram.TelegramOpError> =>
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
  }) as Effect.Effect<Telegram.User, Telegram.TelegramOpError>;

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const profileMap = (props: ProfileProps): Record<string, ProfileValue> => ({
  ...(props.default ? { "": props.default } : {}),
  ...props.locales,
});

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
      result[language_code] = {
        ...(name.name ? { name: name.name } : {}),
        ...(description.description
          ? { description: description.description }
          : {}),
        ...(short.short_description
          ? { short_description: short.short_description }
          : {}),
      };
    }
    return result;
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
        if (locale.name !== undefined && locale.name !== live.name) {
          yield* call(
            news,
            Telegram.setMyName({ ...language, name: locale.name }),
          );
        } else if (
          language_code &&
          locale.name === undefined &&
          old.name !== undefined
        ) {
          yield* call(news, Telegram.setMyName({ ...language, name: "" }));
        }
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

export const WebhookProvider = () =>
  Provider.succeed(WebhookConfig, {
    stables: ["bot_id"],
    read: Effect.fn(function* ({ olds, output }) {
      const user = yield* identify(olds, output?.bot_id);
      if (isLocalUrl(olds.url)) return output;
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
      if (!isLocalUrl(news.url)) {
        yield* call(
          news,
          Telegram.setWebhook({
            url: news.url,
            secret_token: Redacted.value(news.secret_token),
            allowed_updates: news.allowed_updates
              ? [...news.allowed_updates]
              : undefined,
            drop_pending_updates: news.drop_pending_updates,
          }),
        );
      }
      return {
        bot_id: user.id,
        url: news.url,
        allowed_updates: news.allowed_updates,
      };
    }),
    delete: Effect.fn(function* ({ olds, output }) {
      yield* identify(olds, output.bot_id);
      if (!isLocalUrl(olds.url)) {
        yield* call(olds, Telegram.deleteWebhook({}));
      }
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
