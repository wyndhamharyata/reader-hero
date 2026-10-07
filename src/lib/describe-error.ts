import type {
  AiFailure,
  BookNotFound,
  EpubFailure,
  ParsedMissing,
  PdfFailure,
  StorageFailure,
  UnsupportedFile,
} from "@/domain/errors";

export function describeError(
  error: BookNotFound | EpubFailure | ParsedMissing | PdfFailure | StorageFailure | UnsupportedFile,
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
      return `${name} could not be saved. Storage may be full.`;
    case "BookNotFound":
      return `${name} is no longer in your library.`;
    case "ParsedMissing":
      return `${name} needs its reader view rebuilt.`;
  }
}

// The one line a result sheet shows for a failed AI action.
export function describeAiFailure(error: AiFailure | StorageFailure): string {
  if (error._tag === "StorageFailure") return "The result could not be saved";
  switch (error.reason) {
    case "offline":
      return "Offline";
    case "unauthorized":
      return "Key rejected";
    case "rate-limited":
      return "Rate limited";
    default:
      return `Provider error: ${error.message}`;
  }
}
