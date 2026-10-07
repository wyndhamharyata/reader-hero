import { Layer, ManagedRuntime } from "effect";
import { AiClient } from "@/services/ai-client";
import { ArtifactStore } from "@/services/artifact-store";
import { BookStore } from "@/services/book-store";
import { FigureSlots } from "@/services/figure-slots";
import { PageRenderer } from "@/services/page-renderer";
import { PdfClient } from "@/services/pdf-client";
import { ServiceWorkerClient } from "@/services/service-worker-client";
import { SettingsStore } from "@/services/settings-store";

const appLayer = Layer.mergeAll(
  BookStore.layer,
  PdfClient.layer,
  SettingsStore.layer,
  FigureSlots.layer,
  PageRenderer.layer,
  ServiceWorkerClient.layer,
  ArtifactStore.layer,
  AiClient.layer,
);

export const runtime = ManagedRuntime.make(appLayer);

export type AppServices =
  | BookStore
  | PdfClient
  | SettingsStore
  | FigureSlots
  | PageRenderer
  | ServiceWorkerClient
  | ArtifactStore
  | AiClient;
