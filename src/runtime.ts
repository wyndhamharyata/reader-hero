import { Layer, ManagedRuntime } from "effect";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PdfClient } from "@/services/pdf-client";
import { ServiceWorkerClient } from "@/services/service-worker-client";
import { SettingsStore } from "@/services/settings-store";

const appLayer = Layer.mergeAll(
  BookStore.layer,
  PdfClient.layer,
  SettingsStore.layer,
  FigureSlots.layer,
  ServiceWorkerClient.layer,
);

export const runtime = ManagedRuntime.make(appLayer);

export type AppServices =
  | BookStore
  | PdfClient
  | SettingsStore
  | FigureSlots
  | ServiceWorkerClient;
