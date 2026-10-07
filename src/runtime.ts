import { Layer, ManagedRuntime } from "effect";
import { AiClient } from "@/services/ai-client";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PageRenderer } from "@/services/page-renderer";
import { PdfClient } from "@/services/pdf-client";
import { ServiceWorkerClient } from "@/services/service-worker-client";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";

// The summary jobs run on the AI client and the summary store, which the app shares with them.
const aiLayer = Layer.mergeAll(SummaryStore.layer, AiClient.layer);

const appLayer = Layer.mergeAll(
  BookStore.layer,
  PdfClient.layer,
  SettingsStore.layer,
  FigureSlots.layer,
  PageRenderer.layer,
  ServiceWorkerClient.layer,
  aiLayer,
  SummaryJobs.layer.pipe(Layer.provide(aiLayer)),
);

export const runtime = ManagedRuntime.make(appLayer);

export type AppServices =
  | BookStore
  | PdfClient
  | SettingsStore
  | FigureSlots
  | PageRenderer
  | ServiceWorkerClient
  | SummaryStore
  | AiClient
  | SummaryJobs;
