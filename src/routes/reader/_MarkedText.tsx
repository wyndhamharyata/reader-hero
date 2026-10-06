import type { ReactElement } from "react";
import type { Block } from "@/domain/book";

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
        return (
          <span key={start} className={`${bold} ${italic}`}>
            {text.slice(start, end)}
          </span>
        );
      })}
    </>
  );
}
