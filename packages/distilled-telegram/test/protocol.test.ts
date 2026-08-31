import { afterEach, describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  Files,
  TelegramApiError,
  TelegramRequestError,
  TelegramTransportError,
  type TelegramOpContext,
  credentials,
  getMe,
  sendMediaGroup,
  sendMessage,
} from "../src/index.ts";

const token = "123456:TEST_SECRET_TOKEN";
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const run = <A, E>(
  effect: Effect.Effect<A, E, TelegramOpContext>,
  origin: string,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(credentials({ token, apiOrigin: origin })),
      Effect.provide(FetchHttpClient.layer),
    ),
  );

const MediaReferences = Schema.Array(Schema.Struct({ media: Schema.String }));

const parseMediaReferences = Schema.decodeUnknownSync(
  Schema.fromJsonString(MediaReferences),
);

describe("Telegram protocol", () => {
  test("unwraps a successful envelope and tolerates new response fields", async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        expect(new URL(request.url).pathname).toBe(`/bot${token}/getMe`);
        return Response.json({
          ok: true,
          result: {
            id: 42,
            is_bot: true,
            first_name: "Alchemy",
            future_telegram_field:
              "preserved by the wire, ignored by the schema",
          },
        });
      },
    });
    const result = await run(getMe({}), server.url.origin);
    expect(result.id).toBe(42);
    expect(result.first_name).toBe("Alchemy");
  });

  test("keeps the context-capturing operation form", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          ok: true,
          result: { id: 42, is_bot: true, first_name: "Alchemy" },
        }),
    });
    const program = Effect.gen(function* () {
      const callGetMe = yield* getMe;
      return yield* callGetMe({});
    });
    const result = await run(program, server.url.origin);
    expect(result.id).toBe(42);
  });

  test("surfaces Telegram's API envelope as a typed error", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 3 },
        }),
    });
    const error = await run(Effect.flip(getMe({})), server.url.origin);
    expect(error).toBeInstanceOf(TelegramApiError);
    if (!(error instanceof TelegramApiError)) {
      throw new Error("expected TelegramApiError");
    }
    expect(error.error_code).toBe(429);
  });

  test("rejects an invalid request before hitting the network", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => {
        throw new Error("request should not be sent");
      },
    });
    const error = await run(
      Effect.flip(getMe({ unexpected: true })),
      server.url.origin,
    );
    expect(error).toBeInstanceOf(TelegramRequestError);
  });

  test("rejects Telegram integers outside JavaScript's safe range", async () => {
    const error = await run(
      Effect.flip(
        sendMessage({
          chat_id: Number.MAX_SAFE_INTEGER + 1,
          text: "unsafe",
        }),
      ),
      "http://127.0.0.1:1",
    );
    expect(error).toBeInstanceOf(TelegramRequestError);
  });

  test("uploads files nested in Telegram objects with attach references", async () => {
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const form = await request.formData();
        const media = parseMediaReferences(String(form.get("media")));
        expect(media.map((item) => item.media)).toEqual([
          "attach://file_0",
          "attach://file_1",
          "attach://file_2",
        ]);
        expect(form.get("file_0")).toBeInstanceOf(Blob);
        expect(form.get("file_1")).toBeInstanceOf(Blob);
        expect(form.get("file_2")).toBeInstanceOf(Blob);
        return Response.json({
          ok: true,
          result: [
            { message_id: 1, date: 1, chat: { id: 1, type: "private" } },
            { message_id: 2, date: 1, chat: { id: 1, type: "private" } },
            { message_id: 3, date: 1, chat: { id: 1, type: "private" } },
          ],
        });
      },
    });
    const result = await run(
      sendMediaGroup({
        chat_id: 1,
        media: [
          {
            type: "photo",
            media: Files.fromBytes(new TextEncoder().encode("first")),
          },
          {
            type: "photo",
            media: Files.fromStream(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("second"));
                  controller.close();
                },
              }),
            ),
          },
          { type: "photo", media: new Blob(["third"]) },
        ],
      }),
      server.url.origin,
    );
    expect(result.map((message) => message.message_id)).toEqual([1, 2, 3]);
  });

  test("redacts the token from transport failures", async () => {
    const error = await run(Effect.flip(getMe({})), "http://127.0.0.1:1");
    expect(error).toBeInstanceOf(TelegramTransportError);
    expect(JSON.stringify(error)).not.toContain(token);
    expect(String(error)).not.toContain(token);
  });
});
