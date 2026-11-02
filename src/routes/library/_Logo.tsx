import type { ReactElement } from "react";

// Three brackets, graded from light to deep green, with the R of "Reader" inside the front one.
export function Logo({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 886 210"
      className={`mark ${className ?? ""}`}
      role="img"
      aria-label="Reader Hero"
    >
      <path d="M125 21V5H5V171H21" stroke="oklch(72% 0.08 159)" />
      <path d="M141 37V21H21V187H37" stroke="oklch(58% 0.1 159)" />
      <path d="M157 56V37H37V203H157V184" stroke="var(--green)" />
      <text x="92" y="172" fill="currentColor">
        Reader Hero
      </text>
    </svg>
  );
}
