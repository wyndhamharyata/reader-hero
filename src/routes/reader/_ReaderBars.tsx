import type { ReactElement } from "react";
import { ArrowLeftIcon, DocumentTextIcon, EllipsisIcon, ListBulletIcon } from "@/components/icons";
import { SlideLink } from "@/components/SlideLink";

export type ReaderPanel = "contents" | "summary" | "look" | "more";

const tools: ReadonlyArray<{ panel: ReaderPanel; label: string }> = [
  { panel: "contents", label: "Contents" },
  { panel: "summary", label: "Summary" },
  { panel: "look", label: "Look" },
  { panel: "more", label: "More" },
];

function ToolIcon({ panel }: { readonly panel: ReaderPanel }): ReactElement {
  if (panel === "contents") return <ListBulletIcon className="icon" />;
  if (panel === "summary") return <DocumentTextIcon className="icon" />;
  if (panel === "more") return <EllipsisIcon className="icon" />;

  return (
    <span className="aa" aria-hidden="true">
      Aa
    </span>
  );
}

// The tools sit at the bottom on a phone, in reach of a thumb, and in the top bar wider up.
export function ReaderBars({
  title,
  isShown,
  percent,
  ratio,
  onPanel,
}: {
  readonly title: string;
  readonly isShown: boolean;
  readonly percent: string;
  readonly ratio: number;
  readonly onPanel: (panel: ReaderPanel) => void;
}): ReactElement {
  const hidden = isShown ? "" : " is-hidden";
  const fill = `${Math.min(100, Math.max(0, ratio * 100))}%`;

  return (
    <>
      <header className={`bar topbar${hidden}`} inert={!isShown}>
        <SlideLink to="/" direction="out" className="key small square" aria-label="Back to library">
          <ArrowLeftIcon className="icon" />
        </SlideLink>
        <h1 className="min-w-0 flex-1 truncate font-bold">{title}</h1>
        <div className="hidden gap-2 md:flex">
          {tools.map((tool) => (
            <button
              key={tool.panel}
              type="button"
              className={tool.panel === "more" ? "key small square" : "key small"}
              aria-label={tool.panel === "more" ? "More" : undefined}
              onClick={() => onPanel(tool.panel)}
            >
              <ToolIcon panel={tool.panel} />
              {tool.panel !== "more" && tool.label}
            </button>
          ))}
        </div>
      </header>
      <footer className={`bar bottombar${hidden}`} inert={!isShown}>
        <div className="flex items-center gap-3">
          <div className="scrub" role="progressbar" aria-label="Progress" aria-valuetext={percent}>
            <span style={{ width: fill }} />
            <i style={{ left: fill }} />
          </div>
          <span className="min-w-9 text-right text-[13px] text-(--ink-soft) tabular-nums">
            {percent}
          </span>
        </div>
        <div className="flex justify-between gap-2 md:hidden">
          {tools.map((tool) => (
            <button
              key={tool.panel}
              type="button"
              className="key tool-key"
              onClick={() => onPanel(tool.panel)}
            >
              <ToolIcon panel={tool.panel} />
              {tool.label}
            </button>
          ))}
        </div>
      </footer>
    </>
  );
}
