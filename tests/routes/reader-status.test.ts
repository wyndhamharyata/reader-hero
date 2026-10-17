// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ParsedMissing } from "@/domain/errors";
import { ReaderStatus } from "@/routes/reader/_ReaderStatus";

const render = (isRepairing: boolean): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ReaderStatus, {
        status: "error",
        error: new ParsedMissing({ id: "b1" }),
        isRepairing,
        title: "Book",
        onRebuild: () => {},
      }),
    ),
  );

describe("ReaderStatus", () => {
  it("given an out-of-date book being repaired, shows the spinner and no button", () => {
    const html = render(true);

    expect(html).toContain("loading-spinner");
    expect(html).not.toContain("Rebuild reader view");
  });

  it("given a failed repair, shows the rebuild button", () => {
    const html = render(false);

    expect(html).toContain("Rebuild reader view");
    expect(html).not.toContain("loading-spinner");
  });
});
