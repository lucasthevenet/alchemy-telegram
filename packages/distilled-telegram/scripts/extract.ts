#!/usr/bin/env bun
/** Parse the pinned Telegram HTML, apply reviewed patches, and emit Smithy. */
import type { Field, Object as TelegramObject } from "@gramio/schema-parser";
import {
  parseLastVersion,
  parseNavigation,
  parseSections,
  toCustomSchema,
} from "@gramio/schema-parser";
import { load } from "cheerio";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type SmithyShape = Record<string, unknown>;
type SmithyModel = {
  readonly smithy: "2.0";
  readonly metadata: Record<string, unknown>;
  readonly shapes: Record<string, SmithyShape>;
};

type SchemaPatch = {
  readonly description: string;
  readonly object: string;
  readonly assert: { readonly type: TelegramObject["type"] };
  readonly appendVariants: readonly Field[];
};

const root = resolve(import.meta.dir, "..");
const namespace = "com.telegram.botapi";
const id = (name: string): string => `${namespace}#${name}`;
const traits = (description?: string, required = false) => ({
  ...(description
    ? { "smithy.api#documentation": description.replaceAll(/\s+/g, " ").trim() }
    : {}),
  ...(required ? { "smithy.api#required": {} } : {}),
});

const safeName = (value: string): string => {
  const normalized = value.replaceAll(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
};

const shapeName = (...parts: readonly string[]): string =>
  parts
    .flatMap((part) => part.split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");

const readJson = async <A>(path: string): Promise<A> =>
  JSON.parse(await readFile(path, "utf8")) as A;

const html = await readFile(
  resolve(root, "spec/telegram-bot-api.html"),
  "utf8",
);
const currencies = await readJson<Record<string, unknown>>(
  resolve(root, "spec/currencies.json"),
);
const $ = load(html);
const version = parseLastVersion($);
const navigation = parseNavigation($);
const sections = parseSections($, navigation.slice(3)).filter(
  (section) => !section.title.includes(" "),
);
const schema = toCustomSchema(version, sections, Object.keys(currencies));

const oracle = await readJson<{
  readonly version: string;
  readonly methods: Readonly<Record<string, unknown>>;
  readonly types: Readonly<
    Record<string, { readonly fields?: readonly { readonly name: string }[] }>
  >;
}>(resolve(root, "spec/oracles/paulsonoflars-api.json"));

const patchDir = resolve(root, "patches/telegram");
for (const file of (await readdir(patchDir))
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const patch = await readJson<SchemaPatch>(resolve(patchDir, file));
  const object = schema.objects.find(
    (candidate) => candidate.name === patch.object,
  );
  if (!object) throw new Error(`${file}: object ${patch.object} was not found`);
  if (object.type !== patch.assert.type || object.type !== "oneOf") {
    throw new Error(`${file}: ${patch.object} no longer matches its assertion`);
  }
  object.oneOf.push(...patch.appendVariants);
}

const duplicateNames = (
  values: readonly { readonly name: string }[],
): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.name)) duplicates.add(value.name);
    seen.add(value.name);
  }
  return [...duplicates];
};

const objectDuplicates = duplicateNames(schema.objects);
const methodDuplicates = duplicateNames(schema.methods);
if (objectDuplicates.length || methodDuplicates.length) {
  throw new Error(
    `Duplicate declarations: ${[...objectDuplicates, ...methodDuplicates].join(", ")}`,
  );
}
if (version.major !== 10 || version.minor !== 3) {
  throw new Error(
    `Expected Telegram Bot API 10.3, got ${version.major}.${version.minor}`,
  );
}
if (schema.methods.length !== 185) {
  throw new Error(`Expected 185 methods, got ${schema.methods.length}`);
}
if (oracle.version !== "Bot API 10.3") {
  throw new Error(
    `Expected the differential oracle at Bot API 10.3, got ${oracle.version}`,
  );
}

const parsedMethods = new Set(schema.methods.map((method) => method.name));
const missingOracleMethods = Object.keys(oracle.methods).filter(
  (name) => !parsedMethods.has(name),
);
const parsedObjects = new Map(
  schema.objects.map((object) => [object.name, object]),
);
const missingOracleTypes = Object.keys(oracle.types).filter(
  (name) => !parsedObjects.has(name),
);
const fieldMismatches: string[] = [];
for (const [name, oracleType] of Object.entries(oracle.types)) {
  const parsed = parsedObjects.get(name);
  if (!oracleType.fields || parsed?.type !== "fields") continue;
  const actual = new Set(parsed.fields.map((field) => field.key));
  const expected = new Set(oracleType.fields.map((field) => field.name));
  const missing = [...expected].filter((field) => !actual.has(field));
  const extra = [...actual].filter((field) => !expected.has(field));
  if (missing.length || extra.length) {
    fieldMismatches.push(
      `${name} (missing: ${missing.join("|") || "-"}; extra: ${extra.join("|") || "-"})`,
    );
  }
}
if (
  missingOracleMethods.length ||
  missingOracleTypes.length ||
  fieldMismatches.length
) {
  throw new Error(
    `Differential oracle mismatch. Methods: ${missingOracleMethods.join(", ") || "none"}; ` +
      `types: ${missingOracleTypes.join(", ") || "none"}; fields: ${fieldMismatches.join(", ") || "none"}`,
  );
}

const shapes: Record<string, SmithyShape> = {};
const referenced = new Set<string>();

const addShape = (name: string, shape: SmithyShape): string => {
  const target = id(name);
  const existing = shapes[target];
  if (existing && JSON.stringify(existing) !== JSON.stringify(shape)) {
    throw new Error(`Shape collision for ${target}`);
  }
  shapes[target] = shape;
  return target;
};

const fieldTarget = (field: Field, owner: string, member: string): string => {
  switch (field.type) {
    case "integer":
      if (field.enum?.length) {
        return addShape(shapeName(owner, member, "IntegerEnum"), {
          type: "intEnum",
          members: Object.fromEntries(
            field.enum.map((value) => [
              safeName(`${value}`),
              {
                target: "smithy.api#Unit",
                traits: { "smithy.api#enumValue": value },
              },
            ]),
          ),
          traits: {},
        });
      }
      return "smithy.api#Long";
    case "float":
      return "smithy.api#Double";
    case "boolean":
      return "smithy.api#Boolean";
    case "string": {
      const values = field.const ? [field.const] : field.enum;
      if (!values?.length) return "smithy.api#String";
      return addShape(shapeName(owner, member, "StringEnum"), {
        type: "enum",
        members: Object.fromEntries(
          values.map((value, index) => [
            safeName(value || `value_${index}`),
            {
              target: "smithy.api#Unit",
              traits: { "smithy.api#enumValue": value },
            },
          ]),
        ),
        traits: {},
      });
    }
    case "reference":
      referenced.add(field.reference.name);
      return id(field.reference.name);
    case "array": {
      const target = fieldTarget(field.arrayOf, owner, `${member}Item`);
      return addShape(shapeName(owner, member, "List"), {
        type: "list",
        member: { target },
        traits: {},
      });
    }
    case "one_of": {
      const unionName = shapeName(owner, member, "Union");
      const members = Object.fromEntries(
        field.variants.map((variant, index) => {
          const target = fieldTarget(variant, unionName, `Variant${index + 1}`);
          return [`variant_${index + 1}`, { target }];
        }),
      );
      return addShape(unionName, { type: "union", members, traits: {} });
    }
  }
};

const memberShape = (field: Field, owner: string): SmithyShape => ({
  target: fieldTarget(field, owner, field.key || "Value"),
  traits: traits(field.description, field.required === true),
});

for (const object of schema.objects) {
  switch (object.type) {
    case "fields":
      addShape(object.name, {
        type: "structure",
        members: Object.fromEntries(
          object.fields.map((field) => [
            field.key,
            memberShape(field, object.name),
          ]),
        ),
        traits: traits(object.description),
      });
      break;
    case "oneOf":
      addShape(object.name, {
        type: "union",
        members: Object.fromEntries(
          object.oneOf.map((field, index) => [
            `variant_${index + 1}`,
            { target: fieldTarget(field, object.name, `Variant${index + 1}`) },
          ]),
        ),
        traits: traits(object.description),
      });
      break;
    case "enum":
      addShape(object.name, {
        type: "enum",
        members: Object.fromEntries(
          object.values.map((value, index) => [
            safeName(value || `value_${index}`),
            {
              target: "smithy.api#Unit",
              traits: { "smithy.api#enumValue": value },
            },
          ]),
        ),
        traits: traits(object.description),
      });
      break;
    case "file":
      addShape(object.name, {
        type: "blob",
        traits: {
          ...traits(object.description),
          [`${namespace}#inputFile`]: {},
        },
      });
      break;
    case "unknown":
      addShape(object.name, {
        type: "structure",
        members: {},
        traits: traits(object.description),
      });
      break;
  }
}

const operationTargets: { target: string }[] = [];
for (const method of schema.methods) {
  const operationName = `${method.name[0]!.toUpperCase()}${method.name.slice(1)}`;
  const inputName = `${operationName}Request`;
  const outputName = `${operationName}Response`;
  addShape(inputName, {
    type: "structure",
    members: Object.fromEntries(
      method.parameters.map((field) => [
        field.key,
        memberShape(field, inputName),
      ]),
    ),
    traits: { "smithy.api#input": {} },
  });
  const returnField = {
    ...method.returns,
    key: "result",
    required: true,
  } as Field;
  addShape(outputName, {
    type: "structure",
    members: {
      result: {
        target: fieldTarget(returnField, outputName, "Result"),
        traits: {
          "smithy.api#required": {},
          [`${namespace}#result`]: {},
        },
      },
    },
    traits: { "smithy.api#output": {} },
  });
  const operationTarget = addShape(operationName, {
    type: "operation",
    input: { target: id(inputName) },
    output: { target: id(outputName) },
    traits: {
      "smithy.api#documentation": method.description,
      "smithy.api#http": { method: "POST", uri: `/${method.name}`, code: 200 },
      [`${namespace}#multipart`]: method.hasMultipart,
    },
  });
  operationTargets.push({ target: operationTarget });
}

addShape("TelegramBotApi", {
  type: "service",
  version: `${version.major}.${version.minor}`,
  operations: operationTargets,
  traits: {},
});

const missingReferences = [...referenced]
  .filter((name) => !shapes[id(name)])
  .sort();
if (missingReferences.length) {
  throw new Error(
    `Unresolved Telegram references: ${missingReferences.join(", ")}`,
  );
}

const model: SmithyModel = {
  smithy: "2.0",
  metadata: {
    telegramBotApiVersion: `${version.major}.${version.minor}`,
    telegramBotApiReleaseDate: version.release_date,
    parser: "@gramio/schema-parser@1.2.0",
    methods: schema.methods.length,
    objects: schema.objects.length,
    suppressions: [
      { id: "HttpMethodSemantics", namespace: "*" },
      { id: "UnreferencedShape", namespace: "*" },
    ],
  },
  shapes,
};

await mkdir(resolve(root, ".generated-ir"), { recursive: true });
await mkdir(resolve(root, ".generated-specs"), { recursive: true });
await writeFile(
  resolve(root, ".generated-ir/telegram.json"),
  `${JSON.stringify(schema, null, 2)}\n`,
);
await writeFile(
  resolve(root, ".generated-specs/telegram.json"),
  `${JSON.stringify(model, null, 2)}\n`,
);

console.log(
  `Telegram Bot API ${version.major}.${version.minor}: ${schema.methods.length} methods, ${schema.objects.length} objects, ${Object.keys(shapes).length} Smithy shapes.`,
);
