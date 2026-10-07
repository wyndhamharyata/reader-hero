import { Effect, Stream } from "effect";
import {
  Artifact,
  type AiMessage,
  type AiSettings,
  type BookKind,
  type Summary,
} from "@/domain/ai";
import type { BookMeta, ParsedBook } from "@/domain/book";
import type { AiFailure, StorageFailure } from "@/domain/errors";
import { AiClient } from "@/services/ai-client";
import { ArtifactStore } from "@/services/artifact-store";
import { chapterText, readSoFar, recentPages } from "@/use-cases/ai-context";

export type RecapScope = "recent" | "chapter" | "sofar";

export interface RecapInput {
  readonly meta: BookMeta;
  readonly parsed: ParsedBook;
  readonly kind: BookKind;
  readonly index: number;
  readonly scope: RecapScope;
  // The book's summary, read by the "sofar" scope alone; null for the others, so a chapter that
  // lands while a recap streams does not restart it.
  readonly summary: Summary | null;
}

// Bumped when a prompt changes, so stored recaps made with the old wording are not reused.
const PROMPT_VERSION = 1;

// The request this input produces, and the key that names its stored result: a hash of the model,
// the prompt version and the exact text, so an identical request shows the stored answer with no call.
function build(
  input: RecapInput,
  settings: AiSettings,
): Effect.Effect<{
  readonly key: string;
  readonly heading: string;
  readonly page: number;
  readonly system: string;
  readonly user: string;
}> {
  const passage =
    input.scope === "recent"
      ? recentPages(input.parsed, input.index)
      : input.scope === "chapter"
        ? chapterText(input.parsed, input.index, input.kind)
        : readSoFar(input.parsed, input.index, input.summary);
  const story = input.kind === "story";
  const system = story
    ? "You summarise a story for a reader who is coming back to it. Use only the pages given. Do not name anyone who does not appear in them. Answer in the language of the pages, as one paragraph of at most 150 words."
    : "You summarise a document for a reader who is coming back to it. Use only the pages given. Answer in the language of the pages: the key points as a short list, then one line on where the reader stopped.";
  const by = input.meta.author === undefined ? "" : ` by ${input.meta.author}`;
  const ask =
    input.scope === "sofar"
      ? story
        ? "Summarise the story so far, ending with the latest pages."
        : "List the key points so far, ending with the latest pages."
      : story
        ? "Summarise what happened in these pages."
        : "List the key points of these pages.";
  const user = `Book: ${input.meta.title}${by}.\nChapter: ${passage.heading === "" ? "unknown" : passage.heading}.\n\nPages:\n${passage.text}\n\n${ask}`;
  return Effect.promise(async () => {
    const bytes = new TextEncoder().encode(
      `${settings.model}\n${PROMPT_VERSION}\n${system}\n${user}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const key = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return { key, heading: passage.heading, page: passage.page, system, user };
  });
}

export function storedRecap(
  input: RecapInput,
  settings: AiSettings,
): Effect.Effect<Artifact | null, StorageFailure, ArtifactStore> {
  return Effect.gen(function* () {
    const store = yield* ArtifactStore;
    const { key } = yield* build(input, settings);
    return yield* store.get(key);
  });
}

// Streams the answer through `onText` with the text so far, and stores the artifact when the stream
// ends. An interrupted stream stores nothing.
export function runRecap(
  input: RecapInput,
  settings: AiSettings,
  onText: (text: string) => void,
): Effect.Effect<Artifact, AiFailure | StorageFailure, AiClient | ArtifactStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* ArtifactStore;
    const request = yield* build(input, settings);
    let text = "";
    yield* client
      .complete(settings, request.system, [{ role: "user", content: request.user }])
      .pipe(
        Stream.runForEach((delta) =>
          Effect.sync(() => {
            if (delta.type !== "text") return;
            text += delta.text;
            onText(text);
          }),
        ),
      );
    const artifact = new Artifact({
      key: request.key,
      bookId: input.meta.id,
      kind: "recap",
      heading: request.heading,
      page: request.page,
      model: settings.model,
      createdAt: Date.now(),
      result: text,
      thread: [],
    });
    yield* store.put(artifact);
    return artifact;
  });
}

// A follow-up sends the same pages again with the thread so far, and appends to the artifact.
export function followUp(
  input: RecapInput,
  settings: AiSettings,
  artifact: Artifact,
  question: string,
  onText: (text: string) => void,
): Effect.Effect<Artifact, AiFailure | StorageFailure, AiClient | ArtifactStore> {
  return Effect.gen(function* () {
    const client = yield* AiClient;
    const store = yield* ArtifactStore;
    const request = yield* build(input, settings);
    const messages: Array<AiMessage> = [
      { role: "user", content: request.user },
      { role: "assistant", content: artifact.result },
      ...artifact.thread,
      { role: "user", content: question },
    ];
    let text = "";
    yield* client.complete(settings, request.system, messages).pipe(
      Stream.runForEach((delta) =>
        Effect.sync(() => {
          if (delta.type !== "text") return;
          text += delta.text;
          onText(text);
        }),
      ),
    );
    const next = new Artifact({
      ...artifact,
      thread: [
        ...artifact.thread,
        { role: "user", content: question },
        { role: "assistant", content: text },
      ],
    });
    yield* store.put(next);
    return next;
  });
}
