import type {
  AiFailure,
  BookNotFound,
  EpubFailure,
  ParsedMissing,
  PdfFailure,
  StorageFailure,
  UnexpectedFailure,
  UnsupportedFile,
} from "@/domain/errors";

export function describeError(
  error:
    | BookNotFound
    | EpubFailure
    | ParsedMissing
    | PdfFailure
    | StorageFailure
    | UnexpectedFailure
    | UnsupportedFile,
  name: string,
): string {
  switch (error._tag) {
    case "UnsupportedFile":
      return `${name} is not a PDF or EPUB.`;
    case "EpubFailure":
      switch (error.reason) {
        case "drm":
          return `${name} is protected by DRM.`;
        case "fixed-layout":
          return `${name} is a fixed-layout EPUB, which Reader Hero cannot show yet.`;
        default:
          return `${name} could not be read.`;
      }
    case "PdfFailure":
      switch (error.reason) {
        case "password":
          return `${name} is password protected.`;
        case "corrupt":
          return `${name} could not be read.`;
        case "stalled":
          return `${name} stopped making progress. Try adding it again on its own.`;
        default:
          return `${name} could not be read.`;
      }
    case "StorageFailure":
      // Only a quota error blames the space.
      return error.cause instanceof DOMException && error.cause.name === "QuotaExceededError"
        ? `${name} could not be saved: this device's storage for Reader Hero is full.`
        : `${name} could not be saved.`;
    case "BookNotFound":
      return `${name} is no longer in your library.`;
    case "ParsedMissing":
      return `${name} needs its reader view rebuilt.`;
    case "UnexpectedFailure":
      return `${name} could not be opened: ${error.message}`;
  }
}

export function describeAiFailure(error: AiFailure | StorageFailure): string {
  if (error._tag === "StorageFailure") return "Could not save summary";
  switch (error.reason) {
    case "offline":
      return "Offline";
    case "unauthorized":
      return "Key rejected";
    case "rate-limited":
      return "Rate limited";
    case "malformed":
    case "no-consent":
      return error.message;
    default:
      return `Provider error: ${error.message}`;
  }
}
