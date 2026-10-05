import type {
  BookNotFound,
  ParsedMissing,
  PdfFailure,
  StorageFailure,
  UnsupportedFile,
} from "@/domain/errors";

type AppError = BookNotFound | ParsedMissing | PdfFailure | StorageFailure | UnsupportedFile;

export function describeError(error: AppError, name: string): string {
  switch (error._tag) {
    case "UnsupportedFile":
      return `${name} is not a PDF.`;
    case "PdfFailure":
      switch (error.reason) {
        case "password":
          return `${name} is password protected.`;
        case "corrupt":
          return `${name} could not be read.`;
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
