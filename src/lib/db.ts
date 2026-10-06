import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BookMeta,
  BookPrefs,
  FigureCheckpoint,
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
  prefs: { key: string; value: BookPrefs };
  figures: { key: string; value: FigureCheckpoint };
}

const DB_NAME = "reader-hero";
const DB_VERSION = 4;
export const SETTINGS_KEY = "app";

export async function openReaderDb(): Promise<IDBPDatabase<ReaderDb>> {
  const db = await openDB<ReaderDb>(DB_NAME, DB_VERSION, {
    upgrade(next) {
      if (!next.objectStoreNames.contains("books"))
        next.createObjectStore("books", { keyPath: "id" });
      if (!next.objectStoreNames.contains("files")) next.createObjectStore("files");
      if (!next.objectStoreNames.contains("parsed")) next.createObjectStore("parsed");
      if (!next.objectStoreNames.contains("progress")) next.createObjectStore("progress");
      if (!next.objectStoreNames.contains("settings")) next.createObjectStore("settings");
      if (!next.objectStoreNames.contains("inbox")) {
        next.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
      }
      if (!next.objectStoreNames.contains("images")) next.createObjectStore("images");
      if (!next.objectStoreNames.contains("prefs")) next.createObjectStore("prefs");
      if (!next.objectStoreNames.contains("figures")) next.createObjectStore("figures");
    },
    // A newer version opening elsewhere waits for this connection; let go so its upgrade can run.
    blocking() {
      db.close();
    },
  });
  return db;
}
