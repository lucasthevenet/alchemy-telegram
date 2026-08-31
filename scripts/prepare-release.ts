#!/usr/bin/env bun
/** Set both public package versions and their lockstep dependency together. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as Schema from "effect/Schema";
import { format } from "oxfmt";

const Manifest = Schema.StructWithRest(
  Schema.Struct({
    version: Schema.String,
    dependencies: Schema.Record(Schema.String, Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Manifest),
);

const root = resolve(import.meta.dir, "..");
const version = process.argv[2]?.replace(/^v/, "");
if (
  !version ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    version,
  )
) {
  throw new Error("Usage: bun run release:prepare <semver>");
}

const readManifest = async (path: string) =>
  decodeManifest(await readFile(path, "utf8"));
const writeJson = async (path: string, value: Schema.Json): Promise<void> => {
  const result = await format(path, `${JSON.stringify(value, null, 2)}\n`);
  if (result.errors.length > 0) {
    throw new Error(`Failed to format ${path}`);
  }
  await writeFile(path, result.code);
};

const sdkPath = resolve(root, "packages/distilled-telegram/package.json");
const providerPath = resolve(root, "packages/alchemy-telegram/package.json");
const sdk = await readManifest(sdkPath);
const provider = await readManifest(providerPath);
const nextSdk = { ...sdk, version };
const nextProvider = {
  ...provider,
  version,
  dependencies: {
    ...provider.dependencies,
    "distilled-telegram": version,
  },
};

await Promise.all([
  writeJson(sdkPath, nextSdk),
  writeJson(providerPath, nextProvider),
]);

const install = Bun.spawn(["bun", "install", "--lockfile-only"], {
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await install.exited;
if (exitCode !== 0) process.exit(exitCode);

console.log(`Prepared distilled-telegram and alchemy-telegram ${version}.`);
