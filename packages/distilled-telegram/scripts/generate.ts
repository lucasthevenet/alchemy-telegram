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
  const prelude: Record<string, string> = {
    String: "S.String",
    Boolean: "S.Boolean",
    Long: SAFE_INTEGER_SCHEMA,
    Integer: "S.Number",
    Double: "S.Number",
    Document: "S.Unknown",
    Unit: "S.Unknown",
  };
  return prelude[target.split("#")[1]!] ?? "S.Unknown";
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
  shapeOverride: ({ def, name }) => {
    if (def.type !== "blob") return undefined;
    return [
      `export type ${name} = InputFileLike;`,
      `export const ${name} = S.Unknown as S.Schema<${name}>;\n`,
    ];
  },
  union: ({ name, caseTargets, tsRef }) => [
    `export type ${name} = ${caseTargets.map(tsRef).join(" | ") || "unknown"};`,
    `export const ${name} = /*@__PURE__*/ S.suspend(() =>`,
    `  S.Union([${caseTargets.map(schemaReference).join(", ")}]),`,
    `) as any as S.Schema<${name}>;\n`,
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
  postProcess: (code) =>
    code
      .replace(
        `import * as Retry from "../retry.ts";`,
        `import * as Retry from "../retry.ts";\nimport { makeTelegramOperation } from "../protocol.ts";\nimport type { InputFileLike } from "../files.ts";`,
      )
      .replaceAll("API.make(() =>", "makeTelegramOperation(() =>"),
};

runGeneratorCli({
  description: "Generate the Telegram Bot API Effect SDK",
  root: `${import.meta.dir}/..`,
  patchesDir: false,
  spec: () => spec,
});
