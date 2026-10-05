import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BookMeta,
  ImageRecord,
  ParsedBook,
  ReaderSettings,
  ReadingProgress,
} from "@/domain/book";

export interface InboxFile {
  id?: number;
  name: string;
  blob: Blob;
  addedAt: number;
}

export interface ReaderDb extends DBSchema {
  books: { key: string; value: BookMeta };
  files: { key: string; value: Blob };
  parsed: { key: string; value: ParsedBook };
  progress: { key: string; value: ReadingProgress };
  settings: { key: string; value: ReaderSettings };
  inbox: { key: number; value: InboxFile };
  images: { key: string; value: ImageRecord };
}

export const DB_NAME = "reader-hero";
export const DB_VERSION = 2;
export const SETTINGS_KEY = "app";

export function openReaderDb(): Promise<IDBPDatabase<ReaderDb>> {
  return openDB<ReaderDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("parsed")) db.createObjectStore("parsed");
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress");
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("inbox")) {
        db.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    },
  });
}
