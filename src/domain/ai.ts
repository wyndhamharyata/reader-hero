import { Effect, Schema } from "effect";

export const AiProvider = Schema.Literals([
  "deepseek",
  "openrouter",
  "gemini",
  "anthropic",
  "openai",
  "groq",
  "cerebras",
  "zai",
  "opencode",
  "opencodeConsole",
  "nvidia",
  "mistral",
  "together",
  "compatible",
]);
export type AiProvider = typeof AiProvider.Type;

export const providerLabels: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
  groq: "Groq",
  cerebras: "Cerebras",
  zai: "Z.ai",
  opencode: "OpenCode Go",
  opencodeConsole: "OpenCode Console",
  nvidia: "NVIDIA",
  mistral: "Mistral",
  together: "Together",
  compatible: "OpenAI-compatible",
};

// These hosts refuse requests from a web page, so their keys call through the relay.
export const relayedProviders: ReadonlySet<AiProvider> = new Set([
  "groq",
  "cerebras",
  "zai",
  "opencode",
  "opencodeConsole",
  "nvidia",
  "mistral",
  "together",
  "compatible",
]);

export const BookKind = Schema.Literals(["story", "reference"]);
export type BookKind = typeof BookKind.Type;

// The one AI record in the settings store; the key is stored next to the books and sent to this provider only.
export class AiSettings extends Schema.Class<AiSettings>("reader-hero/domain/AiSettings")({
  provider: AiProvider,
  apiKey: Schema.String,
  model: Schema.String,
  // True only when the provider's list said this model may skip thinking; unset leaves the model to decide.
  reasoningOff: Schema.optional(Schema.Boolean),
  // Only the OpenAI-compatible provider has one; its requests go through the relay.
  baseUrl: Schema.optional(Schema.String),
  consentedAt: Schema.optional(Schema.Int),
  // The consent text that was allowed; unset is the text from before Series grouping.
  consentVersion: Schema.optional(Schema.Int),
  // Records saved before these fields existed decode with their defaults.
  linesInContents: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  autoSummary: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  seriesGrouping: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
}) {}

// The consent text's version; a reader who allowed an older text sees the note again.
export const CONSENT_VERSION = 4;

// The books that Series grouping sent, so each goes once; Remove key keeps this record.
export class GroupedBooks extends Schema.Class<GroupedBooks>("reader-hero/domain/GroupedBooks")({
  ids: Schema.Array(Schema.String),
}) {}

export const AiMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String,
});
export type AiMessage = typeof AiMessage.Type;

// `cache` ends a prefix worth keeping; a provider that bills cache writes keeps only marked prefixes.
export interface PromptPart {
  readonly text: string;
  readonly cache?: boolean;
}

// The parts join with nothing between them, so a split prompt sends the same text as one string.
export interface PromptMessage {
  readonly role: "user" | "assistant";
  readonly content: string | ReadonlyArray<PromptPart>;
}

// `input` counts every prompt token, `hit` and `write` included; a missing field was not reported.
export interface AiUsage {
  readonly input?: number;
  readonly hit?: number;
  readonly write?: number;
  readonly output?: number;
}

// One record per provider and model, so a model change starts its own hit rate.
export class UsageTally extends Schema.Class<UsageTally>("reader-hero/domain/UsageTally")({
  requests: Schema.Int,
  input: Schema.Int,
  hit: Schema.Int,
  write: Schema.Int,
  output: Schema.Int,
  since: Schema.Int,
}) {}

// One record per book, so the job appends to it and never sends a finished chapter twice.
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
  // `chapter` is 1-based; the next merge keeps an edited entry as the reader wrote it.
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
  // Names the reader added and removed, which the next merge must include and leave out.
  required: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  thread: Schema.Array(AiMessage),
  // The chapter that held the position, up to the block before `end`; stale once the position moves.
  current: Schema.optional(
    Schema.Struct({ heading: Schema.String, end: Schema.Int, text: Schema.String }),
  ),
  // The book's paragraph for a series summary, from `chapters` summaries and the current text up to `current`.
  volume: Schema.optional(
    Schema.Struct({
      text: Schema.String,
      chapters: Schema.Int,
      current: Schema.optional(Schema.Int),
      model: Schema.String,
      updatedAt: Schema.Int,
    }),
  ),
}) {}
