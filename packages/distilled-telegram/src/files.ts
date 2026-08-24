/** Portable Telegram upload values and constructors. */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";

const TelegramFileTypeId = Symbol.for("distilled-telegram/InputFile");

export type FileData =
  | Blob
  | File
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | Stream.Stream<Uint8Array, unknown, never>;

export interface TelegramFile {
  readonly [TelegramFileTypeId]: true;
  readonly data: FileData;
  readonly filename?: string;
  readonly contentType?: string;
}

export type InputFileLike = FileData | TelegramFile;

export interface FileOptions {
  readonly filename?: string;
  readonly contentType?: string;
}

export const file = (
  data: FileData,
  options: FileOptions = {},
): TelegramFile => ({
  [TelegramFileTypeId]: true,
  data,
  ...options,
});

export const fromBytes = (
  bytes: Uint8Array | ArrayBuffer,
  options: FileOptions = {},
): TelegramFile => file(bytes, options);

export const fromStream = (
  stream:
    | ReadableStream<Uint8Array>
    | Stream.Stream<Uint8Array, unknown, never>,
  options: FileOptions = {},
): TelegramFile => file(stream, options);

/** Node/Bun helper. Requires the platform FileSystem service. */
export const fromPath = (
  path: string,
  options: Omit<FileOptions, "filename"> & { readonly filename?: string } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(path);
    return file(bytes, {
      ...options,
      filename: options.filename ?? path.split(/[\\/]/).at(-1) ?? "file",
    });
  });

export const isInputFileLike = (value: unknown): value is InputFileLike =>
  (typeof Blob !== "undefined" && value instanceof Blob) ||
  value instanceof Uint8Array ||
  value instanceof ArrayBuffer ||
  (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) ||
  Stream.isStream(value) ||
  (value !== null && typeof value === "object" && TelegramFileTypeId in value);

export interface ResolvedFile {
  readonly blob: Blob;
  readonly filename?: string;
}

const rawToBlob = (data: FileData, contentType?: string) => {
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return Effect.succeed(data);
  }
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const part = data instanceof Uint8Array ? Uint8Array.from(data) : data;
    return Effect.succeed(new Blob([part as BlobPart], { type: contentType }));
  }
  if (Stream.isStream(data)) {
    return Effect.flatMap(Stream.toReadableStreamEffect(data), (readable) =>
      Effect.tryPromise(() => new Response(readable).blob()),
    );
  }
  return Effect.tryPromise(() => new Response(data as ReadableStream).blob());
};

export const resolveInputFile = (
  value: InputFileLike,
): Effect.Effect<ResolvedFile, unknown, never> => {
  const wrapped =
    value !== null && typeof value === "object" && TelegramFileTypeId in value
      ? (value as TelegramFile)
      : undefined;
  return rawToBlob(
    wrapped?.data ?? (value as FileData),
    wrapped?.contentType,
  ).pipe(
    Effect.map((blob) => ({
      blob,
      filename:
        wrapped?.filename ??
        (typeof File !== "undefined" && value instanceof File
          ? value.name
          : undefined),
    })),
  ) as Effect.Effect<ResolvedFile, unknown, never>;
};
