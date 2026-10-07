import type { ReactElement } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon, Bars3Icon } from "@/components/icons";

interface Props {
  title: string;
  chrome: boolean;
  percentLabel: string;
  position: number;
  total: number;
  onMenu: () => void;
}

// A bottom bar on phones, within thumb reach, and a top bar from md up.
export function ReaderNav({
  title,
  chrome,
  percentLabel,
  position,
  total,
  onMenu,
}: Props): ReactElement {
  const hidden = chrome ? "" : "translate-y-full md:-translate-y-full";

  return (
    <nav
      className={`absolute inset-x-0 bottom-0 z-30 flex flex-col-reverse gap-1 border-t border-base-300 bg-base-100 px-2 pt-2 pb-[calc(var(--safe-bottom)+0.75rem)] transition-transform md:top-0 md:bottom-auto md:flex-col md:border-t-0 md:border-b md:pt-[calc(var(--safe-top)+1.25rem)] md:pb-2 ${hidden}`}
    >
      <div className="flex items-center gap-1">
        <Link
          to="/"
          className="btn btn-square btn-ghost btn-lg md:btn-sm"
          aria-label="Back to library"
          title="Back to library"
        >
          <ArrowLeftIcon className="size-7 md:size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-medium md:text-sm">{title}</h1>
        <button
          type="button"
          className="btn btn-square btn-ghost btn-lg md:btn-sm"
          aria-label="Menu"
          title="Menu"
          onClick={onMenu}
        >
          <Bars3Icon className="size-7 md:size-5" />
        </button>
      </div>
      <div className="flex items-center gap-3 px-2 md:px-0">
        <span className="w-10 text-sm opacity-70 md:text-xs">{percentLabel}</span>
        <progress className="progress h-1.5 flex-1 progress-primary" value={position} max={total} />
      </div>
    </nav>
  );
}
