import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Bot, CallbackQuery, Command, Hears, On } from "../src/bot.ts";
import type { Update } from "distilled-telegram";

const messageUpdate = (text: string): Update => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 1,
    chat: { id: 10, type: "private" },
    text,
    entities: [
      { type: "bot_command", offset: 0, length: text.split(" ")[0]!.length },
    ],
  },
});

const runDispatch = (effect: Effect.Effect<void, unknown, unknown>) => {
  // SAFETY: every handler registered by this test file closes over local test
  // state only, so dispatch has no unprovided runtime service requirements.
  return Effect.runPromise(effect as Effect.Effect<void>);
};

describe("Bot application", () => {
  test("dispatches exactly one specialized handler before On", async () => {
    const calls: string[] = [];
    const bot = await Effect.runPromise(
      Bot(
        "Test",
        { token: "1:secret" },
        Effect.gen(function* () {
          yield* Command("link", { description: "Link an account" }, () =>
            Effect.sync(() => calls.push("command")),
          );
          yield* Hears(/.*/, () => Effect.sync(() => calls.push("hears")));
          yield* On("message", () => Effect.sync(() => calls.push("on")));
        }),
        { manageResources: false },
      ),
    );
    await runDispatch(bot.dispatch(messageUpdate("/link account")));
    expect(calls).toEqual(["command"]);
  });

  test("routes invalid command arguments to onInvalidArgs", async () => {
    const calls: string[] = [];
    const bot = await Effect.runPromise(
      Bot(
        "Test",
        { token: "1:secret" },
        Effect.gen(function* () {
          yield* Command(
            "count",
            {
              description: "Count",
              args: Schema.Number,
              onInvalidArgs: () => Effect.sync(() => calls.push("invalid")),
            },
            () => Effect.sync(() => calls.push("handler")),
          );
        }),
        { manageResources: false },
      ),
    );
    await runDispatch(bot.dispatch(messageUpdate("/count nope")));
    expect(calls).toEqual(["invalid"]);
  });

  test("automatically answers callback queries after the handler", async () => {
    const calls: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname.split("/").at(-1)!);
        return Response.json({ ok: true, result: true });
      },
    });
    try {
      const bot = await Effect.runPromise(
        Bot(
          "Test",
          { token: "1:secret", apiOrigin: server.url.origin },
          Effect.gen(function* () {
            yield* CallbackQuery("confirm", () =>
              Effect.sync(() => calls.push("handler")),
            );
          }),
          { manageResources: false },
        ),
      );
      await runDispatch(
        bot.dispatch({
          update_id: 1,
          callback_query: {
            id: "callback-1",
            from: { id: 1, is_bot: false, first_name: "User" },
            chat_instance: "chat",
            data: "confirm",
          },
        }),
      );
      expect(calls).toEqual(["handler", "answerCallbackQuery"]);
    } finally {
      server.stop(true);
    }
  });

  test("does not answer a callback twice when the handler answers it", async () => {
    const calls: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname.split("/").at(-1)!);
        return Response.json({ ok: true, result: true });
      },
    });
    try {
      const bot = await Effect.runPromise(
        Bot(
          "Test",
          { token: "1:secret", apiOrigin: server.url.origin },
          Effect.gen(function* () {
            yield* CallbackQuery("confirm", (context) =>
              context.answerCallbackQuery({ text: "Done" }),
            );
          }),
          { manageResources: false },
        ),
      );
      await runDispatch(
        bot.dispatch({
          update_id: 1,
          callback_query: {
            id: "callback-1",
            from: { id: 1, is_bot: false, first_name: "User" },
            chat_instance: "chat",
            data: "confirm",
          },
        }),
      );
      expect(calls).toEqual(["answerCallbackQuery"]);
    } finally {
      server.stop(true);
    }
  });
});
