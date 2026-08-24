/** Telegram Bot API JSON-envelope and recursive multipart protocol. */
import type * as AST from "effect/SchemaAST";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as API from "@distilled.cloud/core/api";
import { ConfigError } from "@distilled.cloud/core/errors";
import { getAnn, getProps, mapKeys } from "@distilled.cloud/core/protocol-http";
import { Credentials, type Config } from "./credentials.ts";
import {
  TelegramApiError,
  TelegramDecodeError,
  TelegramRequestError,
  TelegramTransportError,
  UnknownTelegramError,
  type DefaultErrors,
} from "./errors.ts";
import { httpSymbol, type HttpTrait } from "./traits.ts";
import { Retry } from "./retry.ts";
import {
  isInputFileLike,
  resolveInputFile,
  type ResolvedFile,
} from "./files.ts";

export type TelegramOpError = DefaultErrors | ConfigError;

export type TelegramOpContext = Credentials | HttpClient.HttpClient;

type Envelope = {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
  readonly parameters?: unknown;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

const parseEnvelope = (body: string): Envelope | undefined => {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed === null || typeof parsed !== "object") return undefined;
    const value = parsed as Record<string, unknown>;
    if (typeof value.ok !== "boolean") return undefined;
    return value as Envelope;
  } catch {
    return undefined;
  }
};

const encodeMultipart = (
  input: Record<string, unknown>,
): Effect.Effect<
  {
    readonly body: Record<string, unknown>;
    readonly files: readonly [string, ResolvedFile][];
  },
  unknown
> => {
  const files: [string, ResolvedFile][] = [];
  const visit = (value: unknown): Effect.Effect<unknown, unknown> =>
    Effect.gen(function* () {
      if (isInputFileLike(value)) {
        const name = `file_${files.length}`;
        files.push([name, yield* resolveInputFile(value)]);
        return `attach://${name}`;
      }
      if (Array.isArray(value)) {
        return yield* Effect.forEach(value, visit);
      }
      if (value !== null && typeof value === "object") {
        const entries = yield* Effect.forEach(
          Object.entries(value as Record<string, unknown>).filter(
            ([, item]) => item !== undefined,
          ),
          ([key, item]) =>
            Effect.map(visit(item), (mapped) => [key, mapped] as const),
        );
        return Object.fromEntries(entries);
      }
      return value;
    });
  return Effect.map(visit(input), (body) => ({
    body: body as Record<string, unknown>,
    files,
  }));
};

const makeRequest = (
  input: Record<string, unknown>,
  inputAst: AST.AST,
  config: Config,
): Effect.Effect<HttpClientRequest.HttpClientRequest, unknown> =>
  Effect.gen(function* () {
    const http = getAnn(inputAst, httpSymbol) as HttpTrait | undefined;
    if (!http)
      return yield* Effect.die("Telegram operation is missing its HTTP trait");
    const token = Redacted.value(config.token);
    const url = `${normalizeOrigin(config.apiOrigin)}/bot${token}${http.uri}`;
    const wireInput = mapKeys(inputAst, input, "encode") as Record<
      string,
      unknown
    >;
    const encoded = yield* encodeMultipart(wireInput);
    const request = HttpClientRequest.post(url);
    if (encoded.files.length === 0) {
      return request.pipe(HttpClientRequest.bodyJsonUnsafe(encoded.body));
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(encoded.body)) {
      if (value === undefined || value === null) continue;
      form.append(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
    }
    for (const [name, file] of encoded.files) {
      form.append(name, file.blob, file.filename ?? name);
    }
    return request.pipe(HttpClientRequest.bodyFormData(form));
  });

const fail = (error: unknown): Effect.Effect<never> =>
  Effect.fail(error) as Effect.Effect<never>;

const decodeResponse = ({
  response,
  outputAst,
}: {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly outputAst: AST.AST;
}) =>
  Effect.gen(function* () {
    const text = yield* response.text.pipe(Effect.orDie);
    const envelope = parseEnvelope(text);
    if (!envelope) {
      return yield* fail(
        new TelegramDecodeError({
          message: "Telegram returned a malformed response envelope",
          body: text,
          cause: "Expected a JSON object with an ok boolean",
        }),
      );
    }
    if (!envelope.ok) {
      if (
        typeof envelope.error_code === "number" &&
        typeof envelope.description === "string"
      ) {
        return yield* fail(
          new TelegramApiError({
            error_code: envelope.error_code,
            description: envelope.description,
            parameters: envelope.parameters,
          }),
        );
      }
      return yield* fail(
        new UnknownTelegramError({
          message: envelope.description ?? `HTTP ${response.status}`,
          status: response.status,
          body: envelope,
        }),
      );
    }
    const mapped = mapKeys(outputAst, envelope.result, "decode");
    return yield* Schema.decodeUnknownEffect(Schema.make(outputAst))(
      mapped,
    ).pipe(
      Effect.catchEager((cause) =>
        fail(
          new TelegramDecodeError({
            message: "Telegram response did not match the generated schema",
            body: envelope.result,
            cause,
          }),
        ),
      ),
    );
  });

export const TelegramProtocol: Layer.Layer<API.Protocol> = Layer.succeed(
  API.Protocol,
  API.Protocol.of({
    encode: ({ input, inputAst }) =>
      Effect.gen(function* () {
        const resolve = yield* Credentials;
        const config = yield* resolve;
        if (
          getProps(inputAst).length === 0 &&
          input !== null &&
          typeof input === "object" &&
          Object.keys(input as object).length > 0
        ) {
          return yield* Effect.fail(
            new TelegramRequestError({
              message: "Telegram request contains unknown fields",
              cause: Object.keys(input as object),
            }),
          );
        }
        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.make(inputAst),
        )(input, { onExcessProperty: "error" }).pipe(
          Effect.mapError(
            (cause) =>
              new TelegramRequestError({
                message: "Telegram request did not match the generated schema",
                cause,
              }),
          ),
        );
        return yield* makeRequest(
          decoded as Record<string, unknown>,
          inputAst,
          config,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new TelegramRequestError({
                message: "Telegram file input could not be encoded",
                cause,
              }),
          ),
        );
      }) as Effect.Effect<HttpClientRequest.HttpClientRequest>,
    decode: (args) => decodeResponse(args) as Effect.Effect<unknown>,
  }),
);

/**
 * Wrap core's dual-style operation so transport failures cannot expose the
 * bot token embedded in Telegram's request URL.
 */
export const makeTelegramOperation = (config: () => any): any => {
  const target = API.make(() => ({ ...config(), retry: undefined })) as any;
  const sanitize = (effect: Effect.Effect<any, any, any>) => {
    const safe = effect.pipe(
      Effect.catchIf(HttpClientError.isHttpClientError, (error) =>
        Effect.fail(
          new TelegramTransportError({
            message: "Telegram HTTP transport failed",
            cause: { reason: error.reason._tag },
          }),
        ),
      ),
    );
    return Effect.flatMap(Effect.serviceOption(Retry), (configured) => {
      if (Option.isNone(configured)) return safe;
      return Effect.gen(function* () {
        const lastError = yield* Ref.make<unknown>(undefined);
        const options =
          typeof configured.value === "function"
            ? configured.value(lastError)
            : configured.value;
        if (!options.while) return yield* safe;
        return yield* safe.pipe(
          Effect.tapError((error) => Ref.set(lastError, error)),
          Effect.retry({
            while: options.while,
            ...(options.schedule ? { schedule: options.schedule as any } : {}),
          }),
        );
      });
    });
  };
  let proxy: any;
  const asEffect = () =>
    Effect.map(
      Effect.context(),
      (captured) => (input: unknown) =>
        Effect.updateContext(
          sanitize(target(input)),
          (current): Context.Context<any> => Context.merge(captured, current),
        ),
    );
  proxy = new Proxy(target, {
    apply: (_target, thisArg, args) =>
      sanitize(Reflect.apply(target, thisArg, args)),
    get: (object, property, receiver) =>
      property === "asEffect"
        ? asEffect
        : Reflect.get(object, property, receiver),
  });
  return proxy;
};
