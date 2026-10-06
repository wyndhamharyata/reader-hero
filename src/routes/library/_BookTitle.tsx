import type { ReactElement } from "react";

interface Props {
  title: string;
  clipStart: boolean;
  size: "text-lg" | "text-sm";
  fit: "truncate" | "line-clamp-2";
}

export function BookTitle({ title, clipStart, size, fit }: Props): ReactElement {
  if (!clipStart) return <h2 className={`${size} font-semibold ${fit}`}>{title}</h2>;

  // A right-to-left box puts the ellipsis at the start; the <bdi> keeps "Vol. 7" in reading order.
  return (
    <h2 className={`${size} truncate text-left font-semibold [direction:rtl]`}>
      <bdi dir="ltr">{title}</bdi>
    </h2>
  );
}
