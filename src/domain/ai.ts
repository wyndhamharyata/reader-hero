import { Effect, Schema } from "effect";

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

export const SummaryLength = Schema.Literals(["line", "paragraph"]);
export type SummaryLength = typeof SummaryLength.Type;

// The one AI record in the settings store; the key is stored next to the books and sent to this provider only.
export class AiSettings extends Schema.Class<AiSettings>("reader-hero/domain/AiSettings")({
  provider: AiProvider,
  apiKey: Schema.String,
  model: Schema.String,
  effort: Schema.optional(Schema.String),
  consentedAt: Schema.optional(Schema.Int),
  // Records saved before these fields existed decode with their defaults.
  linesInContents: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  autoSummary: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  summaryLength: SummaryLength.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed<SummaryLength>("paragraph")),
  ),
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

// One summary per book: a paragraph per chapter in reading order, each from one request, and the
// names drawn from those paragraphs. The job appends to it and never sends a chapter twice.
export class Summary extends Schema.Class<Summary>("reader-hero/domain/Summary")({
  bookId: Schema.String,
  model: Schema.String,
  updatedAt: Schema.Int,
  chapters: Schema.Array(
    Schema.Struct({
      heading: Schema.String,
      page: Schema.Int,
      line: Schema.String,
      paragraph: Schema.String,
    }),
  ),
  // `chapter` is the 1-based chapter where the entry first appears.
  names: Schema.Array(
    Schema.Struct({ name: Schema.String, note: Schema.String, chapter: Schema.Int }),
  ),
  // How many chapters the names list covers; it lags behind `chapters` until the next merge.
  namesThrough: Schema.Int,
  // Names the reader added, which the next merge must include.
  required: Schema.Array(Schema.String),
  thread: Schema.Array(AiMessage),
}) {}
