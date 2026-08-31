#!/usr/bin/env bun
/** Validate lockstep metadata, provenance, exports, and npm tarball contents. */
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

type PackageJson = {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly repository: {
    readonly type: string;
    readonly url: string;
    readonly directory: string;
  };
  readonly publishConfig?: {
    readonly access?: string;
    readonly provenance?: boolean;
  };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly [key: string]: unknown;
};

type PackResult = {
  readonly name: string;
  readonly version: string;
  readonly files: readonly { readonly path: string }[];
};

const root = resolve(import.meta.dir, "..");
const repository = "git+https://github.com/lucasthevenet/alchemy-telegram.git";
const expectedSources = {
  "spec/telegram-bot-api.html": "https://core.telegram.org/bots/api",
  "spec/currencies.json":
    "https://core.telegram.org/bots/payments/currencies.json",
  "spec/oracles/paulsonoflars-api.json":
    "https://raw.githubusercontent.com/PaulSonOfLars/telegram-bot-api-spec/master/api.json",
} as const;
const packages = [
  {
    name: "distilled-telegram",
    directory: "packages/distilled-telegram",
    required: [
      "API.md",
      "LICENSE",
      "README.md",
      "lib/index.d.ts",
      "lib/index.js",
      "lib/services/telegram.d.ts",
      "lib/services/telegram.js",
      "package.json",
      "src/index.ts",
      "src/services/telegram.ts",
    ],
  },
  {
    name: "alchemy-telegram",
    directory: "packages/alchemy-telegram",
    required: [
      "LICENSE",
      "README.md",
      "lib/Cloudflare.d.ts",
      "lib/Cloudflare.js",
      "lib/events.d.ts",
      "lib/events.js",
      "lib/index.d.ts",
      "lib/index.js",
      "package.json",
      "src/Cloudflare.ts",
      "src/events.ts",
      "src/index.ts",
    ],
  },
] as const;

const readJson = async <A>(path: string): Promise<A> =>
  JSON.parse(await readFile(path, "utf8")) as A;
const fail = (message: string): never => {
  throw new Error(message);
};
const sha256 = (value: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

const manifests = new Map<string, PackageJson>();
for (const entry of packages) {
  const manifestPath = resolve(root, entry.directory, "package.json");
  const manifest = await readJson<PackageJson>(manifestPath);
  manifests.set(entry.name, manifest);
  if (manifest.name !== entry.name) {
    fail(`${entry.directory}: expected package name ${entry.name}`);
  }
  if (manifest.license !== "Apache-2.0") {
    fail(`${entry.name}: license must be Apache-2.0`);
  }
  if (
    manifest.repository.type !== "git" ||
    manifest.repository.url !== repository ||
    manifest.repository.directory !== entry.directory
  ) {
    fail(`${entry.name}: repository metadata does not match the public source`);
  }
  if (
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig.provenance !== true
  ) {
    fail(`${entry.name}: public provenance publishing is required`);
  }
  const serialized = JSON.stringify(manifest);
  if (serialized.includes('"catalog:') || serialized.includes('"workspace:')) {
    fail(
      `${entry.name}: publishable metadata contains a workspace-only protocol`,
    );
  }

  const visitExports = async (value: unknown): Promise<void> => {
    if (typeof value === "string") {
      if (!value.includes("*")) {
        const target = resolve(root, entry.directory, value);
        if (!(await Bun.file(target).exists())) {
          fail(`${entry.name}: export target does not exist: ${value}`);
        }
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) await visitExports(child);
    }
  };
  await visitExports(manifest.exports);
}

const sdk = manifests.get("distilled-telegram")!;
const provider = manifests.get("alchemy-telegram")!;
if (sdk.version !== provider.version) {
  fail(
    `Package versions are not lockstep: ${sdk.version} and ${provider.version}`,
  );
}
if (provider.dependencies?.["distilled-telegram"] !== sdk.version) {
  fail("alchemy-telegram must depend on the exact lockstep SDK version");
}
const requestedVersion = process.env.RELEASE_VERSION?.replace(/^v/, "");
if (requestedVersion && requestedVersion !== sdk.version) {
  fail(
    `Release ${requestedVersion} does not match package version ${sdk.version}`,
  );
}

const provenancePath = resolve(
  root,
  "packages/distilled-telegram/spec/provenance.json",
);
const provenance = await readJson<{
  readonly parser: string;
  readonly sources: Readonly<
    Record<
      string,
      { readonly url: string; readonly sha256: string; readonly bytes: number }
    >
  >;
}>(provenancePath);
if (provenance.parser !== "@gramio/schema-parser@1.2.0") {
  fail(`Unexpected parser provenance: ${provenance.parser}`);
}
if (
  Object.keys(provenance.sources).length !== Object.keys(expectedSources).length
) {
  fail("Provenance must identify exactly the three canonical inputs");
}
for (const [relative, url] of Object.entries(expectedSources)) {
  const expected = provenance.sources[relative];
  if (!expected || expected.url !== url) {
    fail(`Unexpected provenance source for ${relative}`);
  }
  const bytes = new Uint8Array(
    await readFile(resolve(root, "packages/distilled-telegram", relative)),
  );
  if (
    bytes.byteLength !== expected.bytes ||
    sha256(bytes) !== expected.sha256
  ) {
    fail(`Provenance mismatch for ${relative}`);
  }
}
const model = await readJson<{
  readonly metadata: {
    readonly telegramBotApiVersion: string;
    readonly methods: number;
  };
}>(resolve(root, "packages/distilled-telegram/.generated-specs/telegram.json"));
if (
  model.metadata.telegramBotApiVersion !== "10.3" ||
  model.metadata.methods !== 185
) {
  fail("Generated model must identify Telegram Bot API 10.3 and 185 methods");
}

const readWorkflow = (name: string): Promise<string> =>
  readFile(resolve(root, ".github/workflows", name), "utf8");
const watcherWorkflow = await readWorkflow("telegram-api-watcher.yml");
for (const forbidden of [
  "npm publish",
  "bun publish",
  "pnpm publish",
  "yarn npm publish",
  "gh pr merge",
  "gh release",
  "id-token: write",
  "packages: write",
  "auto-merge",
]) {
  if (watcherWorkflow.includes(forbidden)) {
    fail(`Telegram API watcher contains forbidden capability: ${forbidden}`);
  }
}
const releaseWorkflow = await readWorkflow("release.yml");
for (const required of [
  "release:\n    types: [published]",
  "id-token: write",
  "bun run release:validate",
  "bun run test:live",
  "npm publish ./packages/distilled-telegram --access public --provenance",
  "npm publish ./packages/alchemy-telegram --access public --provenance",
]) {
  if (!releaseWorkflow.includes(required)) {
    fail(`Release workflow is missing required behavior: ${required}`);
  }
}
const liveWorkflow = await readWorkflow("live.yml");
if (
  !liveWorkflow.includes("bun run release:validate") ||
  !liveWorkflow.includes("bun run test:live")
) {
  fail("Scheduled live workflow must run release validation and live tests");
}
for (const relative of [
  "docs/releasing.md",
  "examples/cloudflare-worker/README.md",
  "examples/cloudflare-worker/alchemy.run.ts",
  "examples/cloudflare-worker/fixture.ts",
]) {
  if (!(await Bun.file(resolve(root, relative)).exists())) {
    fail(`Release completion artifact is missing: ${relative}`);
  }
}

const npmCache = resolve(root, "node_modules/.cache/npm-release-validation");
await mkdir(npmCache, { recursive: true });
for (const entry of packages) {
  const child = Bun.spawn(
    ["npm", "pack", "--dry-run", "--json", resolve(root, entry.directory)],
    {
      cwd: root,
      env: { ...process.env, npm_config_cache: npmCache },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
  const [pack] = JSON.parse(stdout) as readonly PackResult[];
  if (!pack || pack.name !== entry.name || pack.version !== sdk.version) {
    fail(`${entry.name}: npm pack returned unexpected metadata`);
  }
  const files = new Set(pack.files.map((file) => file.path));
  for (const required of entry.required) {
    if (!files.has(required))
      fail(`${entry.name}: tarball is missing ${required}`);
  }
  for (const path of files) {
    if (
      /^(?:test|scripts|spec|\.generated-ir|\.generated-specs)\//.test(path) ||
      /(?:^|\/)\.env(?:\.|$)/.test(path) ||
      path.startsWith("tsconfig")
    ) {
      fail(`${entry.name}: tarball contains private build input ${path}`);
    }
    if (
      entry.name === "alchemy-telegram" &&
      /^(?:lib|src)\/webhook\.(?:d\.ts|d\.ts\.map|js|js\.map|ts)$/.test(path)
    ) {
      fail(
        `${entry.name}: tarball contains removed WebhookRoute module ${path}`,
      );
    }
  }
  console.log(`${entry.name}@${pack.version}: ${files.size} validated files.`);
}

console.log(
  `Release ${sdk.version} is lockstep, reproducible, and ready for provenance publishing.`,
);
