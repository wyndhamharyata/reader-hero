import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BookMeta, ParsedBook, ReaderSettings, ReadingProgress } from "@/domain/book";

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
}

export const DB_NAME = "reader-hero";
export const DB_VERSION = 1;
export const SETTINGS_KEY = "app";

export function openReaderDb(): Promise<IDBPDatabase<ReaderDb>> {
  return openDB<ReaderDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("books", { keyPath: "id" });
      db.createObjectStore("files");
      db.createObjectStore("parsed");
      db.createObjectStore("progress");
      db.createObjectStore("settings");
      db.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
    },
  });
}
