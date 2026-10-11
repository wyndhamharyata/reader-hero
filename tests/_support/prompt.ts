import type { PromptPart } from "@/domain/ai";

// The text a provider receives, so a fake client can match on it whether or not it was split.
export const plain = (content: string | ReadonlyArray<PromptPart>): string =>
  typeof content === "string" ? content : content.map((part) => part.text).join("");
