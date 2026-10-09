import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AiSettings, GroupedBooks, Summary } from "@/domain/ai";
import type {
  BookMeta,
  BookPrefs,
  FigureCheckpoint,
  ImageRecord,
  ParsedBook,
  ReaderSettings,
  ReadingProgress,
  Series,
  StoredPages,
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
  settings: { key: string; value: ReaderSettings | AiSettings | GroupedBooks };
  inbox: { key: number; value: InboxFile };
  images: { key: string; value: ImageRecord };
  prefs: { key: string; value: BookPrefs };
  figures: { key: string; value: FigureCheckpoint };
  pages: { key: string; value: StoredPages };
  summaries: { key: string; value: Summary };
  series: { key: string; value: Series };
}

const DB_NAME = "reader-hero";
const DB_VERSION = 9;
export const SETTINGS_KEY = "app";
export const AI_SETTINGS_KEY = "ai";

let connection: Promise<IDBPDatabase<ReaderDb>> | null = null;

// One connection per page: Safari's first open after a cold start is slow, and both stores need it.
export function openReaderDb(): Promise<IDBPDatabase<ReaderDb>> {
  connection ??= connect().catch((cause: unknown) => {
    connection = null;
    throw cause;
  });
  return connection;
}

async function connect(): Promise<IDBPDatabase<ReaderDb>> {
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
      if (!next.objectStoreNames.contains("pages")) next.createObjectStore("pages");
      if (!next.objectStoreNames.contains("summaries")) next.createObjectStore("summaries");
      if (!next.objectStoreNames.contains("series")) {
        next.createObjectStore("series", { keyPath: "id" });
      }
      // Version 6 and 7 stored recaps here; the summary holds the chapter being read instead.
      const raw = next as unknown as IDBDatabase;
      if (raw.objectStoreNames.contains("artifacts")) raw.deleteObjectStore("artifacts");
    },
    // A newer version opening elsewhere waits for this connection; let go so its upgrade can run.
    blocking() {
      connection = null;
      db.close();
    },
  });
  return db;
}
