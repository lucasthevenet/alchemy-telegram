import type { Api } from "alchemy-telegram";

type Fixture = {
  readonly name: string;
  readonly path: string;
  readonly update: Api.Update;
};

const origin = (
  process.env.TELEGRAM_EXAMPLE_ORIGIN ?? "http://localhost:8787"
).replace(/\/+$/, "");

const privateChat: Api.Chat = { id: 42, type: "private" };
const sender: Api.User = { id: 42, is_bot: false, first_name: "Local" };
const message = (message_id: number, text: string): Api.Message => ({
  message_id,
  date: 1_700_000_000,
  chat: privateChat,
  from: sender,
  text,
});

const fixtures: readonly Fixture[] = [
  {
    name: "Command",
    path: "/api/telegram/notifications",
    update: {
      update_id: 1,
      message: {
        ...message(1, "/link local-user"),
        entities: [{ type: "bot_command", offset: 0, length: 5 }],
      },
    },
  },
  {
    name: "Hears",
    path: "/api/telegram/notifications",
    update: { update_id: 2, message: message(2, "hello") },
  },
  {
    name: "CallbackQuery",
    path: "/api/telegram/notifications",
    update: {
      update_id: 3,
      callback_query: {
        id: "local-callback",
        from: sender,
        chat_instance: "local-chat-instance",
        data: "confirm:fixture",
      },
    },
  },
  {
    name: "On fallback",
    path: "/api/telegram/notifications",
    update: { update_id: 4, message: message(4, "unmatched") },
  },
  {
    name: "Second Bot",
    path: "/api/telegram/operations",
    update: {
      update_id: 5,
      message: {
        ...message(5, "/status"),
        entities: [{ type: "bot_command", offset: 0, length: 7 }],
      },
    },
  },
];

for (const fixture of fixtures) {
  const response = await fetch(`${origin}${fixture.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixture.update),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${fixture.name}: ${response.status} ${body}`);
  }
  console.log(`${fixture.name}: ${response.status} ${body}`);
}
