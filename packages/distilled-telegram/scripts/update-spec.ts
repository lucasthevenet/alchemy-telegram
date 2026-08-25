#!/usr/bin/env bun
/**
 * Refresh the pinned upstream inputs used by the offline generator.
 *
 * This is the only generation command that talks to the network. A normal
 * `bun run generate` reads the committed snapshots under `spec/`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format } from "oxfmt";

const root = resolve(import.meta.dir, "..");

const sources = {
  "spec/telegram-bot-api.html": "https://core.telegram.org/bots/api",
  "spec/currencies.json":
    "https://core.telegram.org/bots/payments/currencies.json",
  "spec/oracles/paulsonoflars-api.json":
    "https://raw.githubusercontent.com/PaulSonOfLars/telegram-bot-api-spec/master/api.json",
} as const;

const sha256 = (value: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

const normalize = async (
  relativePath: string,
  value: Uint8Array,
): Promise<Uint8Array> => {
  const text = new TextDecoder().decode(value);
  if (relativePath.endsWith(".json")) {
    const result = await format(relativePath, text, {
      endOfLine: "lf",
      printWidth: 80,
      tabWidth: 2,
      useTabs: false,
    });
    if (result.errors.length > 0) {
      throw new Error(`Failed to normalize ${relativePath} as JSON`);
    }
    return new TextEncoder().encode(result.code);
  }
  const html = text.replace(
    /<!-- page generated in [^\n]+ -->\s*$/,
    "<!-- volatile page-generation timing removed -->\n",
  );
  return new TextEncoder().encode(html);
};

const provenance: Record<
  string,
  { readonly url: string; readonly sha256: string; readonly bytes: number }
> = {};

for (const [relativePath, url] of Object.entries(sources)) {
  const response = await fetch(url, {
    headers: { "user-agent": "distilled-telegram-spec-refresh/0.1" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const bytes = await normalize(
    relativePath,
    new Uint8Array(await response.arrayBuffer()),
  );
  const target = resolve(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  provenance[relativePath] = {
    url,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}

const provenancePath = resolve(root, "spec/provenance.json");
const previous = await readFile(provenancePath, "utf8")
  .then(
    (value) =>
      JSON.parse(value) as {
        readonly parser?: string;
        readonly sources?: typeof provenance;
      },
  )
  .catch(() => undefined);
const parser = "@gramio/schema-parser@1.2.0";
if (
  previous?.parser === parser &&
  JSON.stringify(previous.sources) === JSON.stringify(provenance)
) {
  console.log("Telegram spec inputs are unchanged.");
  process.exit(0);
}

await writeFile(
  provenancePath,
  `${JSON.stringify(
    {
      refreshed_at: new Date().toISOString(),
      parser,
      sources: provenance,
    },
    null,
    2,
  )}\n`,
);

console.log(`Refreshed ${Object.keys(sources).length} Telegram spec inputs.`);
