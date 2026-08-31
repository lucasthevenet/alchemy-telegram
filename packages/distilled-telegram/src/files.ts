/** Portable Telegram upload values and constructors. */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Predicate from "effect/Predicate";
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

const isBlob: Predicate.Refinement<unknown, Blob> = (value): value is Blob => {
  const BlobConstructor = globalThis.Blob;
  return (
    Predicate.isFunction(BlobConstructor) && value instanceof BlobConstructor
  );
};

const isReadableStream: Predicate.Refinement<
  unknown,
  ReadableStream<Uint8Array>
> = (value): value is ReadableStream<Uint8Array> => {
  const ReadableStreamConstructor = globalThis.ReadableStream;
  return (
    Predicate.isFunction(ReadableStreamConstructor) &&
    value instanceof ReadableStreamConstructor
  );
};

const isFileData: Predicate.Refinement<unknown, FileData> = (
  value,
): value is FileData =>
  isBlob(value) ||
  value instanceof Uint8Array ||
  value instanceof ArrayBuffer ||
  isReadableStream(value) ||
  Stream.isStream(value);

const hasTelegramFileTypeId = Predicate.hasProperty(TelegramFileTypeId);
const hasData = Predicate.hasProperty("data");

const isTelegramFile: Predicate.Refinement<unknown, TelegramFile> = (
  value,
): value is TelegramFile =>
  hasTelegramFileTypeId(value) &&
  value[TelegramFileTypeId] === true &&
  hasData(value) &&
  isFileData(value.data);

export const isInputFileLike: Predicate.Refinement<unknown, InputFileLike> = (
  value,
): value is InputFileLike => isFileData(value) || isTelegramFile(value);

export interface ResolvedFile {
  readonly blob: Blob;
  readonly filename?: string;
}

const rawToBlob = (data: FileData, contentType?: string) => {
  if (isBlob(data)) {
    return Effect.succeed(data);
  }
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const part =
      data instanceof Uint8Array ? Uint8Array.from(data).buffer : data;
    return Effect.succeed(new Blob([part], { type: contentType }));
  }
  if (Stream.isStream(data)) {
    return Effect.flatMap(Stream.toReadableStreamEffect(data), (readable) =>
      Effect.tryPromise(() => new Response(readable).blob()),
    );
  }
  return Effect.tryPromise(() => new Response(data).blob());
};

export const resolveInputFile = (
  value: InputFileLike,
): Effect.Effect<ResolvedFile, unknown, never> => {
  const wrapped = isTelegramFile(value) ? value : undefined;
  const data = isTelegramFile(value) ? value.data : value;
  return rawToBlob(data, wrapped?.contentType).pipe(
    Effect.map((blob) => ({
      blob,
      filename:
        wrapped?.filename ??
        (isBlob(value) &&
        Predicate.hasProperty(value, "name") &&
        Predicate.isString(value.name)
          ? value.name
          : undefined),
    })),
  );
};
