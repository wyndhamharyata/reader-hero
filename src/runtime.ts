import { Layer, ManagedRuntime } from "effect";
import { BookStore } from "@/services/book-store";
import { PdfClient } from "@/services/pdf-client";
import { SettingsStore } from "@/services/settings-store";

const appLayer = Layer.mergeAll(BookStore.layer, PdfClient.layer, SettingsStore.layer);

export const runtime = ManagedRuntime.make(appLayer);

export type AppServices = BookStore | PdfClient | SettingsStore;
