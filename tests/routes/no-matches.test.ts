import { describe, expect, it } from "vitest";
import { noMatchesText } from "@/routes/library/_NoMatches";

describe("noMatchesText", () => {
  it("given only a search, names the words and clears the search", () => {
    expect(noMatchesText(" dune ", null)).toEqual({
      heading: 'Nothing for "dune"',
      action: "Clear search",
    });
  });

  it("given only a filter, names the filter and shows all books", () => {
    expect(noMatchesText("", "finished")).toEqual({
      heading: "No finished books",
      action: "Show all books",
    });
  });

  it("given both and long words, cuts the words and clears both", () => {
    expect(noMatchesText("a".repeat(30), "reading")).toEqual({
      heading: `Nothing for "${"a".repeat(24)}…" in Reading`,
      action: "Clear both",
    });
  });
});
