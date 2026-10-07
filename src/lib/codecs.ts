import { Schema } from "effect";
import { AiSettings, Artifact, Summary } from "@/domain/ai";
import {
  BookMeta,
  BookPrefs,
  FigureCheckpoint,
  ImageRecord,
  ParsedBook,
  ReaderSettings,
  ReadingProgress,
  StoredPages,
} from "@/domain/book";

export const decodeBookMeta = Schema.decodeUnknownEffect(BookMeta);
export const decodeParsedBook = Schema.decodeUnknownEffect(ParsedBook);
export const decodeReadingProgress = Schema.decodeUnknownEffect(ReadingProgress);
export const decodeReaderSettings = Schema.decodeUnknownEffect(ReaderSettings);
export const decodeImageRecord = Schema.decodeUnknownEffect(ImageRecord);
export const decodeBookPrefs = Schema.decodeUnknownEffect(BookPrefs);
export const decodeFigureCheckpoint = Schema.decodeUnknownEffect(FigureCheckpoint);
export const decodeStoredPages = Schema.decodeUnknownEffect(StoredPages);
export const decodeAiSettings = Schema.decodeUnknownEffect(AiSettings);
export const decodeArtifact = Schema.decodeUnknownEffect(Artifact);
export const decodeSummary = Schema.decodeUnknownEffect(Summary);
