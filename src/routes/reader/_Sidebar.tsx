import type { ReaderFont, ReaderSettings, ReaderTheme, TocEntry } from "@/domain/book";
import { AdjustmentsIcon, BookOpenIcon } from "./_icons";

interface Props {
  open: boolean;
  toc: ReadonlyArray<TocEntry>;
  modeLabel: string;
  settings: ReaderSettings;
  onSelect: (blockIndex: number) => void;
  onToggleMode: () => void;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
}

const themes: ReadonlyArray<{ value: ReaderTheme; label: string }> = [
  { value: "rhlight", label: "Light" },
  { value: "rhsepia", label: "Sepia" },
  { value: "rhdark", label: "Dark" },
];

const fonts: ReadonlyArray<{ value: ReaderFont; label: string }> = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
];

const lineHeights: ReadonlyArray<number> = [1.4, 1.6, 1.8];

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;

export function Sidebar({
  open,
  toc,
  modeLabel,
  settings,
  onSelect,
  onToggleMode,
  onSettingsChange,
  onClose,
}: Props) {
  if (!open) return null;

  const smaller = Math.max(MIN_FONT_SIZE, settings.fontSize - 1);
  const larger = Math.min(MAX_FONT_SIZE, settings.fontSize + 1);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-80 max-w-[85%] flex-col bg-base-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Menu</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <ul className="menu mt-2 w-full">
          <li>
            <button type="button" onClick={onToggleMode}>
              <BookOpenIcon className="size-4" />
              {modeLabel}
            </button>
          </li>
        </ul>

        <details className="mt-2 rounded-box border border-base-300 p-3" open>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <AdjustmentsIcon className="size-4" />
            Text settings
          </summary>

          <section className="mt-3">
            <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Theme</p>
            <div className="flex gap-2">
              {themes.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  className={settings.theme === theme.value ? "btn btn-sm btn-active" : "btn btn-sm"}
                  onClick={() => onSettingsChange({ theme: theme.value })}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-3">
            <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Font</p>
            <div className="flex gap-2">
              {fonts.map((font) => (
                <button
                  key={font.value}
                  type="button"
                  className={settings.font === font.value ? "btn btn-sm btn-active" : "btn btn-sm"}
                  onClick={() => onSettingsChange({ font: font.value })}
                >
                  {font.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-3">
            <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Size</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onSettingsChange({ fontSize: smaller })}
                disabled={settings.fontSize <= MIN_FONT_SIZE}
              >
                A-
              </button>
              <span className="w-12 text-center text-sm">{settings.fontSize}px</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onSettingsChange({ fontSize: larger })}
                disabled={settings.fontSize >= MAX_FONT_SIZE}
              >
                A+
              </button>
            </div>
          </section>

          <section className="mt-3">
            <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Line spacing</p>
            <div className="flex gap-2">
              {lineHeights.map((height) => (
                <button
                  key={height}
                  type="button"
                  className={settings.lineHeight === height ? "btn btn-sm btn-active" : "btn btn-sm"}
                  onClick={() => onSettingsChange({ lineHeight: height })}
                >
                  {height}
                </button>
              ))}
            </div>
          </section>
        </details>

        <h3 className="mt-4 text-sm font-semibold">Contents</h3>
        <ul className="menu mt-1 min-h-0 flex-1 w-full overflow-y-auto">
          {toc.length === 0 && <li className="p-2 text-sm opacity-70">No table of contents found.</li>}
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
