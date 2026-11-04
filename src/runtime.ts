import { Layer, ManagedRuntime } from "effect";
import { AiClient } from "@/services/ai-client";
import { AnnotationStore } from "@/services/annotation-store";
import { BookStore } from "@/services/book-store";
import { FigureJobs } from "@/services/figure-jobs";
import { FigureSlots } from "@/services/figure-slots";
import { PageRenderer } from "@/services/page-renderer";
import { PdfClient } from "@/services/pdf-client";
import { ServiceWorkerClient } from "@/services/service-worker-client";
import { SettingsStore } from "@/services/settings-store";
import { SummaryJobs } from "@/services/summary-jobs";
import { SummaryStore } from "@/services/summary-store";

// The summary jobs run on the AI client and the stores, which the app shares with them.
const aiLayer = Layer.mergeAll(
  SummaryStore.layer,
  AiClient.layer.pipe(Layer.provide(SettingsStore.layer)),
);

const appLayer = Layer.mergeAll(
  BookStore.layer,
  AnnotationStore.layer,
  PdfClient.layer,
  SettingsStore.layer,
  FigureSlots.layer,
  PageRenderer.layer,
  ServiceWorkerClient.layer,
  aiLayer,
  SummaryJobs.layer.pipe(Layer.provide(Layer.mergeAll(aiLayer, BookStore.layer))),
  FigureJobs.layer.pipe(
    Layer.provide(Layer.mergeAll(BookStore.layer, PdfClient.layer, FigureSlots.layer)),
  ),
);

export const runtime = ManagedRuntime.make(appLayer);

export type AppServices =
  | BookStore
  | PdfClient
  | SettingsStore
  | FigureSlots
  | FigureJobs
  | PageRenderer
  | ServiceWorkerClient
  | SummaryStore
  | AnnotationStore
  | AiClient
  | SummaryJobs;
