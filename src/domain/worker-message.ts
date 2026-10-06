import { Schema } from "effect";

// The page asks a waiting service worker to take over.
export const WorkerMessage = Schema.Struct({ type: Schema.Literal("SKIP_WAITING") });
export type WorkerMessage = typeof WorkerMessage.Type;
