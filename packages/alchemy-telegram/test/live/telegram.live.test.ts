import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Api from "distilled-telegram";
import * as Redacted from "effect/Redacted";
import * as AlchemyTest from "alchemy/Test/Bun";
import { Sync } from "alchemy";
import { CommandSet, providers } from "../../src/index.ts";
import { withRestoredDefaultCommands } from "./live-fixture.ts";

const enabled = process.env.TELEGRAM_LIVE === "1";

const runtime = Layer.mergeAll(Api.CredentialsFromEnv, FetchHttpClient.layer);
const token = Redacted.make(process.env.TELEGRAM_BOT_TOKEN ?? "");
const alchemy = AlchemyTest.make({ providers: providers(), stage: "live" });

test.skipIf(!enabled)("live credentials identify a Telegram Bot", async () => {
  expect(process.env.TELEGRAM_BOT_TOKEN).toBeTruthy();

  const identity = await Effect.runPromise(
    Api.getMe({}).pipe(Effect.provide(runtime)),
  );

  expect(identity.is_bot).toBe(true);
  expect(Number.isSafeInteger(identity.id)).toBe(true);
});

test.skipIf(!enabled)(
  "live API failures are typed and redact the token",
  async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Api.getChat({
          chat_id: "@alchemy_telegram_live_test_missing_chat",
        }).pipe(Effect.provide(runtime)),
      ),
    );

    expect(error).toBeInstanceOf(Api.TelegramApiError);
    expect(JSON.stringify(error)).not.toContain(
      process.env.TELEGRAM_BOT_TOKEN!,
    );
  },
);

alchemy.test.provider.skipIf(!enabled)(
  "Command Set survives deploy, update, drift repair, and destroy",
  (stack) =>
    withRestoredDefaultCommands(
      Effect.gen(function* () {
        const first = [
          { command: "alchemy_live", description: "Live version one" },
        ];
        const second = [
          { command: "alchemy_live", description: "Live version two" },
        ];
        const resource = (commands: readonly Api.BotCommand[]) =>
          CommandSet("LiveDefaultCommands", {
            token,
            commands,
            scope: { type: "default" },
          });

        const created = yield* stack.deploy(resource(first));
        const identity = yield* Api.getMe({}).pipe(Effect.provide(runtime));
        expect(created.bot_id).toBe(identity.id);
        expect(
          yield* Api.getMyCommands({}).pipe(Effect.provide(runtime)),
        ).toEqual(first);

        yield* stack.deploy(resource(second));
        expect(
          yield* Api.getMyCommands({}).pipe(Effect.provide(runtime)),
        ).toEqual(second);

        yield* Api.setMyCommands({
          commands: [{ command: "alchemy_drift", description: "Out of band" }],
        }).pipe(Effect.provide(runtime));
        const detected = yield* Sync.sync(
          { name: stack.name, stage: "live" },
          { dryRun: true },
        );
        expect(Object.values(detected.resources)[0]?.action).toBe("drifted");

        const repaired = yield* Sync.sync({ name: stack.name, stage: "live" });
        expect(Object.values(repaired.resources)[0]?.action).toBe("repaired");
        expect(
          yield* Api.getMyCommands({}).pipe(Effect.provide(runtime)),
        ).toEqual(second);

        yield* stack.destroy();
        expect(
          yield* Api.getMyCommands({}).pipe(Effect.provide(runtime)),
        ).toEqual([]);
      }),
    ),
  { timeout: 120_000 },
);
