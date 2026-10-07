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
}) {}

export const AiMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String,
});
export type AiMessage = typeof AiMessage.Type;

// One summary per book: a paragraph per chapter in reading order, each from one request, the
// names drawn from those paragraphs, and the chapter being read, summarised up to the position.
// The job appends to it and never sends a finished chapter twice.
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
  // `chapter` is the 1-based chapter where the entry first appears; an edited entry is the
  // reader's and the next merge keeps it as written.
  names: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      note: Schema.String,
      chapter: Schema.Int,
      edited: Schema.optional(Schema.Boolean),
    }),
  ),
  // How many chapters the names list covers; it lags behind `chapters` until the next merge.
  namesThrough: Schema.Int,
  // Names the reader added, which the next merge must include, and names the reader removed,
  // which it must leave out.
  required: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  thread: Schema.Array(AiMessage),
  // The chapter that held the position, up to the block before `end`; stale once the position moves.
  current: Schema.optional(
    Schema.Struct({ heading: Schema.String, end: Schema.Int, text: Schema.String }),
  ),
}) {}
