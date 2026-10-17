// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkedText } from "@/routes/reader/_MarkedText";

const render = (text: string, href: string, start: number, end: number): string =>
  renderToStaticMarkup(
    createElement(MarkedText, { text, marks: [{ start, end, style: "link", href }] }),
  );

describe("MarkedText links", () => {
  it("given an internal link, marks its target without a block attribute", () => {
    const html = render("see later", "#block-3", 4, 9);

    expect(html).toContain('data-link-block="3"');
    expect(html).not.toContain("data-block=");
  });

  it("given an external link, opens it in a new tab", () => {
    const html = render("see site", "https://example.com", 4, 8);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("data-link-block");
  });
});
