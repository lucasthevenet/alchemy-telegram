/** Telegram Bot API JSON-envelope and recursive multipart protocol. */
import type * as AST from "effect/SchemaAST";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
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
import { httpSymbol } from "./traits.ts";
import { Retry } from "./retry.ts";
import {
  isInputFileLike,
  resolveInputFile,
  type InputFileLike,
  type ResolvedFile,
} from "./files.ts";

export type TelegramOpError = DefaultErrors | ConfigError;

export type TelegramOpContext = Credentials | HttpClient.HttpClient;

const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  error_code: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.String),
  parameters: Schema.optional(Schema.Unknown),
});

const EnvelopeFromJson = Schema.fromJsonString(Envelope);

const TelegramHttpBinding = Schema.Struct({ uri: Schema.String });

type MultipartPrimitive = string | number | boolean | null | undefined;

interface MultipartArray extends ReadonlyArray<MultipartValue> {}

interface MultipartObject {
  readonly [key: string]: MultipartValue;
}

type MultipartValue =
  | MultipartPrimitive
  | InputFileLike
  | MultipartArray
  | MultipartObject;

interface EncodedMultipartArray extends ReadonlyArray<EncodedMultipartValue> {}

interface EncodedMultipartObject {
  readonly [key: string]: EncodedMultipartValue;
}

type EncodedMultipartValue =
  | MultipartPrimitive
  | EncodedMultipartArray
  | EncodedMultipartObject;

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

const parseEnvelope = Schema.decodeUnknownOption(EnvelopeFromJson);

const isMultipartArray = (value: MultipartValue): value is MultipartArray =>
  Array.isArray(value);

const isMultipartObject = (value: MultipartValue): value is MultipartObject =>
  Predicate.isObject(value) && !isInputFileLike(value);

const encodeMultipart = (
  input: MultipartObject,
): Effect.Effect<
  {
    readonly body: EncodedMultipartObject;
    readonly files: readonly [string, ResolvedFile][];
  },
  unknown
> => {
  const files: [string, ResolvedFile][] = [];
  const visit = (
    value: MultipartValue,
  ): Effect.Effect<EncodedMultipartValue, unknown> =>
    Effect.gen(function* () {
      if (isInputFileLike(value)) {
        const name = `file_${files.length}`;
        files.push([name, yield* resolveInputFile(value)]);
        return `attach://${name}`;
      }
      if (isMultipartArray(value)) {
        return yield* Effect.forEach(value, visit);
      }
      if (isMultipartObject(value)) {
        return yield* visitObject(value);
      }
      return value;
    });

  const visitObject = (
    value: MultipartObject,
  ): Effect.Effect<EncodedMultipartObject, unknown> =>
    Effect.map(
      Effect.forEach(
        Object.entries(value).filter(([, item]) => item !== undefined),
        ([key, item]) =>
          Effect.map(visit(item), (mapped) => [key, mapped] as const),
      ),
      Object.fromEntries,
    );

  return Effect.map(visitObject(input), (body) => ({
    body,
    files,
  }));
};

const makeRequest = (
  input: MultipartObject,
  inputAst: AST.AST,
  config: Config,
): Effect.Effect<HttpClientRequest.HttpClientRequest, unknown> =>
  Effect.gen(function* () {
    const http = Schema.decodeUnknownOption(TelegramHttpBinding)(
      getAnn(inputAst, httpSymbol),
    );
    if (Option.isNone(http))
      return yield* Effect.die("Telegram operation is missing its HTTP trait");
    const token = Redacted.value(config.token);
    const url = `${normalizeOrigin(config.apiOrigin)}/bot${token}${http.value.uri}`;
    // SAFETY: `input` passed its generated request schema, and `mapKeys` only
    // renames keys. It preserves the recursive multipart value contract.
    const wireInput = mapKeys(inputAst, input, "encode") as MultipartObject;
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
        Predicate.isObjectOrArray(value)
          ? JSON.stringify(value)
          : String(value),
      );
    }
    for (const [name, file] of encoded.files) {
      form.append(name, file.blob, file.filename ?? name);
    }
    return request.pipe(HttpClientRequest.bodyFormData(form));
  });

const fail = (cause: unknown): Effect.Effect<never> => {
  // SAFETY: distilled's Protocol service fixes its error channel to `never`,
  // while generated OperationMethod declarations carry these typed failures.
  return Effect.fail(cause) as Effect.Effect<never>;
};

const decodeResponse = ({
  response,
  outputAst,
}: {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly outputAst: AST.AST;
}) =>
  Effect.gen(function* () {
    const text = yield* response.text.pipe(Effect.orDie);
    const parsedEnvelope = parseEnvelope(text);
    if (Option.isNone(parsedEnvelope)) {
      return yield* fail(
        new TelegramDecodeError({
          message: "Telegram returned a malformed response envelope",
          body: text,
          cause: "Expected a JSON object with an ok boolean",
        }),
      );
    }
    const envelope = parsedEnvelope.value;
    if (!envelope.ok) {
      if (
        envelope.error_code !== undefined &&
        envelope.description !== undefined
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
    encode: ({ input, inputAst }) => {
      const request = Effect.gen(function* () {
        const resolve = yield* Credentials;
        const config = yield* resolve;
        if (
          getProps(inputAst).length === 0 &&
          Predicate.isObject(input) &&
          Object.keys(input).length > 0
        ) {
          return yield* fail(
            new TelegramRequestError({
              message: "Telegram request contains unknown fields",
              cause: Object.keys(input),
            }),
          );
        }
        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.make(inputAst),
        )(input, { onExcessProperty: "error" }).pipe(
          Effect.catchEager((cause) =>
            fail(
              new TelegramRequestError({
                message: "Telegram request did not match the generated schema",
                cause,
              }),
            ),
          ),
        );
        if (!Predicate.isObject(decoded)) {
          return yield* fail(
            new TelegramRequestError({
              message: "Telegram request schema did not produce an object",
              cause: decoded,
            }),
          );
        }
        // SAFETY: every generated Telegram request is a struct whose leaves
        // are JSON primitives or declared InputFileLike values.
        const multipartInput = decoded as MultipartObject;
        return yield* makeRequest(multipartInput, inputAst, config).pipe(
          Effect.catchEager((cause) =>
            fail(
              new TelegramRequestError({
                message: "Telegram file input could not be encoded",
                cause,
              }),
            ),
          ),
        );
      });
      // SAFETY: Credentials is deliberately resolved per call from the
      // caller's context; distilled Protocol cannot express that requirement.
      return request as Effect.Effect<HttpClientRequest.HttpClientRequest>;
    },
    decode: (args) => {
      const decoded = decodeResponse(args);
      // SAFETY: generated Telegram response schemas have no service
      // requirements; the dynamic AST type cannot retain that fact.
      return decoded as Effect.Effect<unknown>;
    },
  }),
);

const sanitizeOperation = <A, OperationError, R>(
  effect: Effect.Effect<A, OperationError | HttpClientError.HttpClientError, R>,
) => {
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
      const options = Predicate.isFunction(configured.value)
        ? configured.value(lastError)
        : configured.value;
      if (!options.while) return yield* safe;
      const retryable = safe.pipe(
        Effect.tapError((error) => Ref.set(lastError, error)),
      );
      return options.schedule
        ? yield* retryable.pipe(
            Effect.retry({
              while: options.while,
              schedule: options.schedule,
            }),
          )
        : yield* retryable.pipe(Effect.retry({ while: options.while }));
    });
  });
};

/**
 * Wrap core's dual-style operation so transport failures cannot expose the
 * bot token embedded in Telegram's request URL.
 */
export const makeTelegramOperation = <
  I extends Schema.Top,
  O extends Schema.Top,
  const E extends readonly API.ApiErrorClass[],
>(
  config: () => API.OperationConfig<I, O, never, never, E>,
): API.OperationMethod<
  Schema.Schema.Type<I>,
  Schema.Schema.Type<O>,
  TelegramOpError,
  TelegramOpContext
> => {
  const target = API.make(() => ({ ...config(), retry: undefined }));

  const asEffect = () =>
    Effect.map(
      Effect.context<TelegramOpContext>(),
      (captured) => (input: Schema.Schema.Type<I>) =>
        Effect.updateContext(
          sanitizeOperation(target(input)),
          (current: Context.Context<never>) => Context.merge(captured, current),
        ),
    );

  const operation = (input: Schema.Schema.Type<I>) =>
    sanitizeOperation(target(input));
  Object.defineProperties(operation, Object.getOwnPropertyDescriptors(target));
  Object.defineProperty(operation, "asEffect", {
    value: asEffect,
    configurable: true,
  });

  // SAFETY: descriptors copied from API.make provide Effect's iterator and
  // pipe protocol. Direct and yielded calls both pass through sanitization.
  return operation as API.OperationMethod<
    Schema.Schema.Type<I>,
    Schema.Schema.Type<O>,
    TelegramOpError,
    TelegramOpContext
  >;
};
