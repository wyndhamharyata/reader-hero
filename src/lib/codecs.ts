import { Schema } from "effect";
import { BookMeta, ImageRecord, ParsedBook, ReaderSettings, ReadingProgress } from "@/domain/book";

export const decodeBookMeta = Schema.decodeUnknownEffect(BookMeta);
export const decodeParsedBook = Schema.decodeUnknownEffect(ParsedBook);
export const decodeReadingProgress = Schema.decodeUnknownEffect(ReadingProgress);
export const decodeReaderSettings = Schema.decodeUnknownEffect(ReaderSettings);
export const decodeImageRecord = Schema.decodeUnknownEffect(ImageRecord);
