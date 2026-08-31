#!/usr/bin/env bun
/** Compile the normalized Telegram Smithy model into the Effect SDK. */
import type { SdkSpec } from "@distilled.cloud/core/codegen/generator";
import { runGeneratorCli } from "@distilled.cloud/core/codegen/cli";
import {
  JSON_PRELUDE,
  TS_JSON_PRELUDE,
} from "@distilled.cloud/core/codegen/prelude";

const RESULT_TRAIT = "com.telegram.botapi#result";
const SAFE_INTEGER_SCHEMA =
  "S.Int.check(S.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }))";

const schemaReference = (target: string): string => {
  if (!target.startsWith("smithy.api#")) return target.split("#")[1]!;
  switch (target.split("#")[1]) {
    case "String":
      return "S.String";
    case "Boolean":
      return "S.Boolean";
    case "Long":
      return SAFE_INTEGER_SCHEMA;
    case "Integer":
    case "Double":
      return "S.Number";
    case "Document":
    case "Unit":
    default:
      return "S.Unknown";
  }
};

const spec: SdkSpec = {
  prelude: { ...JSON_PRELUDE, Long: SAFE_INTEGER_SCHEMA },
  tsPrelude: { ...TS_JSON_PRELUDE, Long: "number" },
  extraBindings: [
    {
      trait: RESULT_TRAIT,
      binding: "result",
      pipe: "T.Result()",
      rootPipe: "T.ResultRoot()",
    },
  ],
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `shapeOverride` is the required property name in the external SdkSpec contract.
  shapeOverride: ({ def, name }) => {
    if (def.type !== "blob") return undefined;
    return [
      `export type ${name} = InputFileLike;`,
      `export const ${name} = generatedSchema<${name}>(S.Unknown);\n`,
    ];
  },
  union: ({ name, caseTargets, tsRef }) => [
    `export type ${name} = ${caseTargets.map(tsRef).join(" | ") || "unknown"};`,
    `export const ${name} = generatedSchema<${name}>(/*@__PURE__*/ S.suspend(() =>`,
    `  S.Union([${caseTargets.map(schemaReference).join(", ")}]),`,
    `));\n`,
  ],
  operationDecl: {
    contextType: "TelegramOpContext",
    commonErrorType: "TelegramOpError",
    commonErrorClasses: [
      "TelegramApiError",
      "TelegramDecodeError",
      "TelegramRequestError",
      "TelegramTransportError",
      "UnknownTelegramError",
    ],
    protocol: "TelegramProtocol",
    retry: "Retry.Retry",
  },
  sourceNote: "the pinned Telegram Bot API 10.3 documentation snapshot",
  postProcess: (code) => {
    const generatedSchemaHelper = `
const generatedSchema = <A>(schema: S.Top): S.Schema<A> => {
  // SAFETY: The Smithy generator emits the TypeScript declaration and its
  // matching runtime schema from the same validated model definition.
  return schema as S.Schema<A>;
};
`;
    const schemaCast =
      /export const ([A-Za-z_$][\w$]*) = ([\s\S]*?) as any as S\.Schema<\1>;/gu;
    const processed = code
      .replace(
        `import * as Retry from "../retry.ts";`,
        `import * as Retry from "../retry.ts";\nimport * as TelegramRuntime from "../protocol.ts";\nimport type { InputFileLike } from "../files.ts";`,
      )
      .replace(
        `export type { TelegramOpError, TelegramOpContext };`,
        `export type { TelegramOpError, TelegramOpContext };\n${generatedSchemaHelper}`,
      )
      .replace(
        schemaCast,
        (_statement, name: string, expression: string) =>
          `export const ${name} = generatedSchema<${name}>(${expression});`,
      )
      .replaceAll(
        "API.make(() =>",
        "TelegramRuntime.makeTelegramOperation(() =>",
      );
    if (processed.includes(" as any as S.Schema<")) {
      throw new Error("Generated service contains an unnormalized schema cast");
    }
    return processed;
  },
};

runGeneratorCli({
  description: "Generate the Telegram Bot API Effect SDK",
  root: `${import.meta.dir}/..`,
  patchesDir: false,
  spec: () => spec,
});
