import type { ReactElement } from "react";
import type { Block } from "@/domain/book";
import { blockIndexOf } from "@/lib/links";

interface Props {
  text: string;
  marks: Block["marks"];
}

// Marks may overlap, so the text splits at every mark edge and each piece takes all marks over it.
export function MarkedText({ text, marks = [] }: Props): ReactElement {
  const cuts = [
    ...new Set([0, text.length, ...marks.flatMap((mark) => [mark.start, mark.end])]),
  ].sort((a, b) => a - b);

  return (
    <>
      {cuts.slice(1).map((end, piece) => {
        const start = cuts[piece] ?? 0;
        const over = marks.filter((mark) => mark.start <= start && mark.end >= end);
        const bold = over.some((mark) => mark.style === "bold") ? "font-bold" : "";
        const italic = over.some((mark) => mark.style === "italic") ? "italic" : "";
        const link = over.find((mark) => mark.style === "link" && mark.href !== undefined);

        if (link?.href !== undefined) {
          const block = blockIndexOf(link.href);

          return (
            <a
              key={start}
              href={link.href}
              className={`${bold} ${italic} text-primary underline underline-offset-2`}
              data-link-block={block ?? undefined}
              target={block === null ? "_blank" : undefined}
              rel={block === null ? "noreferrer" : undefined}
            >
              {text.slice(start, end)}
            </a>
          );
        }

        return (
          <span key={start} className={`${bold} ${italic}`}>
            {text.slice(start, end)}
          </span>
        );
      })}
    </>
  );
}
