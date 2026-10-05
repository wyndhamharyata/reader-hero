import { Cause } from "effect";
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

/**
 * Turns any failure or defect into a user-visible message. Defects (thrown
 * errors) bypass the typed error channel, so without this an unexpected error
 * would fail silently with no message.
 */
export function describeCause(cause: Cause.Cause<unknown>, name: string): string {
  try {
    const error = Cause.squash(cause);
    if (error !== null && typeof error === "object" && "_tag" in error) {
      return describeError(error as AppError, name);
    }
    return `${name} failed: ${error instanceof Error ? error.message : String(error)}`;
  } catch (defect) {
    return `${name} failed: ${defect instanceof Error ? defect.message : String(defect)}`;
  }
}
