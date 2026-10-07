import { Schema } from "effect";

export const AiProvider = Schema.Literals([
  "deepseek",
  "openrouter",
  "gemini",
  "anthropic",
  "openai",
]);
export type AiProvider = typeof AiProvider.Type;

export const providerLabels: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export const BookKind = Schema.Literals(["story", "reference"]);
export type BookKind = typeof BookKind.Type;

// The one AI record in the settings store; the key is stored next to the books and sent to this provider only.
export class AiSettings extends Schema.Class<AiSettings>("reader-hero/domain/AiSettings")({
  provider: AiProvider,
  apiKey: Schema.String,
  model: Schema.String,
  effort: Schema.optional(Schema.String),
  consentedAt: Schema.optional(Schema.Int),
}) {}

export const AiMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String,
});
export type AiMessage = typeof AiMessage.Type;

// A stored result. The key is a hash of the model, the prompt version and the context text, so an
// identical request shows the stored answer without a call.
export class Artifact extends Schema.Class<Artifact>("reader-hero/domain/Artifact")({
  key: Schema.String,
  bookId: Schema.String,
  kind: Schema.Literals(["recap"]),
  heading: Schema.String,
  page: Schema.Int,
  model: Schema.String,
  createdAt: Schema.Int,
  result: Schema.String,
  thread: Schema.Array(AiMessage),
}) {}
