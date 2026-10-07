import type { BookKind } from "@/domain/ai";
import type { BookMeta, ParsedBook } from "@/domain/book";
import { guessMode, sectionSignals } from "@/lib/guess-mode";

const quotes = '"“”„«»「」『』‘';

// A tie goes to story: a wrong story guess hides some names, a wrong reference guess shows later chapters.
export function guessKind(meta: BookMeta, parsed: ParsedBook): BookKind {
  if (guessMode(meta, parsed) === "original") return "reference";

  const { found, numbered, citations } = sectionSignals(parsed);
  let paragraphs = 0;
  let withQuotes = 0;
  for (const block of parsed.blocks) {
    if (block.kind !== "paragraph") continue;
    paragraphs += 1;
    if ([...quotes].some((quote) => block.text.includes(quote))) withQuotes += 1;
    if (paragraphs === 400) break;
  }

  let score = found;
  if (citations) score += 1;
  if (numbered >= 3) score += 1;
  if (paragraphs >= 50 && withQuotes / paragraphs < 0.05) score += 1;
  return score >= 2 ? "reference" : "story";
}
