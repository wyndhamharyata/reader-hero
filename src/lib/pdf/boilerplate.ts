import type { PageLines, TextLine } from "./types";

const BAND = 0.09;
const PAGE_NUMBER = /^(page\s*)?[-–—]?\s*\d+\s*[-–—]?$/i;

const normalize = (text: string): string =>
  text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function bandOf(line: TextLine, height: number): "top" | "bottom" | null {
  if (height <= 0) return null;
  if (line.y > height * (1 - BAND)) return "top";
  if (line.y < height * BAND) return "bottom";
  return null;
}

export function dropBoilerplate(pages: ReadonlyArray<PageLines>): ReadonlyArray<PageLines> {
  const counts = new Map<string, number>();

  for (const page of pages) {
    for (const line of page.lines) {
      const band = bandOf(line, page.height);
      if (band === null) continue;
      const key = `${band}|${normalize(line.text)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));

  return pages.map((page) => ({
    page: page.page,
    height: page.height,
    lines: page.lines.filter((line) => {
      const band = bandOf(line, page.height);
      if (band === null) return true;
      if (PAGE_NUMBER.test(line.text.trim())) return false;
      return (counts.get(`${band}|${normalize(line.text)}`) ?? 0) < threshold;
    }),
  }));
}
