import type { ReactElement } from "react";

interface Props {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

export function FilterChip({ label, count, isActive, onClick }: Props): ReactElement {
  const look = isActive ? "btn-primary" : "btn-ghost border-base-300";
  return (
    <button
      type="button"
      className={`btn shrink-0 rounded-full btn-sm ${look}`}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}
