import type { BookMeta, ParsedBook, ReaderMode } from "@/domain/book";

// Section names that papers and reports use and novels do not, in English and Indonesian.
const markers = new Set([
  "abstract",
  "abstrak",
  "introduction",
  "pendahuluan",
  "related work",
  "background",
  "latar belakang",
  "method",
  "methods",
  "methodology",
  "metode",
  "metodologi",
  "results",
  "hasil",
  "discussion",
  "pembahasan",
  "conclusion",
  "conclusions",
  "kesimpulan",
  "references",
  "bibliography",
  "daftar pustaka",
  "acknowledgments",
  "acknowledgements",
  "executive summary",
  "ringkasan eksekutif",
]);

const numbering = "0123456789.ivx)";

// "2. Related Work:", "IV. RESULTS", and "BAB I PENDAHULUAN" all become their bare section name.
function sectionName(text: string): string {
  const words = text.toLowerCase().trim().split(" ");
  if (words[0] === "bab" && words.length > 2) words.shift();
  const first = words[0] ?? "";
  if (words.length > 1 && [...first].every((char) => numbering.includes(char))) words.shift();
  let name = words.join(" ");
  while (name.endsWith(":") || name.endsWith(".")) name = name.slice(0, -1);
  return name;
}

// Papers, reports, slides, and forms read better as their pages; novels and long prose reflow well.
export function guessMode(meta: BookMeta, parsed: ParsedBook): ReaderMode {
  if (meta.parseState === "scanned") return "original";

  const perPage = parsed.charCount / Math.max(1, parsed.pageCount);
  if (perPage < 700) return "original";

  const found = new Set<string>();
  let citations = false;
  let numbered = 0;
  for (const block of parsed.blocks) {
    if (block.text.length <= 60) {
      const name = sectionName(block.text);
      if (markers.has(name)) found.add(name);
      // Report-style numbering such as "2." or "3.1." ahead of a short title.
      const first = block.text.trim().split(" ")[0] ?? "";
      if (first.includes(".") && [...first].every((char) => "0123456789.".includes(char))) {
        numbered += 1;
      }
    }
    if (block.page <= 3) {
      const text = block.text.toLowerCase();
      if (text.includes("doi.org") || text.includes("doi:") || text.includes("arxiv")) {
        citations = true;
      }
    }
  }

  // Assignments, handouts, forms, and letters are short; 10 pages or fewer settles it alone.
  let score = found.size;
  if (citations) score += 1;
  if (numbered >= 3) score += 1;
  if (parsed.pageCount <= 10) score += 3;
  else if (parsed.pageCount <= 40) score += 1;
  return score >= 3 ? "original" : "reader";
}
