import type { ReactElement } from "react";

interface Props {
  title: string;
  isClippedAtStart: boolean;
  size: "text-lg" | "text-sm";
  fit: "truncate" | "line-clamp-2";
}

export function BookTitle({ title, isClippedAtStart, size, fit }: Props): ReactElement {
  if (!isClippedAtStart) return <h2 className={`${size} font-semibold ${fit}`}>{title}</h2>;

  // A right-to-left box puts the ellipsis at the start. The <bdi> keeps "Vol. 7" in reading order.
  return (
    <h2 className={`${size} truncate text-left font-semibold [direction:rtl]`}>
      <bdi dir="ltr">{title}</bdi>
    </h2>
  );
}
