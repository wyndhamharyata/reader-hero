import { Schema } from "effect";
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
