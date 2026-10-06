import type { ReactElement } from "react";

interface Props {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

export function FilterChip({ label, count, active, onClick }: Props): ReactElement {
  const look = active ? "btn-primary" : "btn-ghost border-base-300";
  return (
    <button
      type="button"
      className={`btn shrink-0 rounded-full btn-sm ${look}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}
