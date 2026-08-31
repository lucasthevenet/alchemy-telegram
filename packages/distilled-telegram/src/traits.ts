/** Schema annotations used by the Telegram Bot API protocol. */
import { makeAnnotation } from "@distilled.cloud/core/trait";

export {
  Body,
  Header,
  Http,
  HttpBody,
  KeyDictionary,
  Label,
  Query,
  ResponseCode,
  UnionCases,
  bodySymbol,
  headerSymbol,
  httpBodySymbol,
  httpSymbol,
  keyDictionarySymbol,
  labelSymbol,
  querySymbol,
  responseCodeSymbol,
  unionCasesSymbol,
  type HttpTrait,
} from "@distilled.cloud/core/trait";

export const resultSymbol = Symbol.for("distilled-telegram/result");
export const resultRootSymbol = Symbol.for("distilled-telegram/result-root");

export const Result = () => makeAnnotation(resultSymbol, true);
export const ResultRoot = () => makeAnnotation(resultRootSymbol, true);
