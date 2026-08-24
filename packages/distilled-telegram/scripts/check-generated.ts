#!/usr/bin/env bun
/** Regenerate the SDK and fail when committed generated artifacts were stale. */

const root = `${import.meta.dir}/..`;
const generated = [
  ".generated-ir/*.json",
  ".generated-specs/*.json",
  "src/services/*.ts",
] as const;

const readGenerated = async () => {
  const snapshot = new Map<string, string>();
  for (const pattern of generated) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: root,
      dot: true,
      onlyFiles: true,
    })) {
      snapshot.set(path, await Bun.file(`${root}/${path}`).text());
    }
  }
  return snapshot;
};

const before = await readGenerated();
const child = Bun.spawn(["bun", "run", "generate"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);

const after = await readGenerated();
const paths = new Set([...before.keys(), ...after.keys()]);
const changed = [...paths].filter(
  (path) => before.get(path) !== after.get(path),
);
if (changed.length > 0) {
  console.error(
    `Generated artifacts were stale:\n${changed.map((path) => `- ${path}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(`Generated artifacts are deterministic (${after.size} files).`);
