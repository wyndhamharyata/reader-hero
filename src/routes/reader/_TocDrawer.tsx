import type { TocEntry } from "@/domain/book";

interface Props {
  open: boolean;
  toc: ReadonlyArray<TocEntry>;
  onSelect: (blockIndex: number) => void;
  onClose: () => void;
}

export function TocDrawer({ open, toc, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <aside className="relative z-10 h-full w-80 max-w-[85%] overflow-y-auto bg-base-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Contents</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {toc.length === 0 && <p className="mt-4 text-sm opacity-70">No table of contents found.</p>}

        <ul className="menu mt-2 w-full">
          {toc.map((entry, index) => (
            <li key={index}>
              <button type="button" onClick={() => onSelect(entry.blockIndex)}>
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
