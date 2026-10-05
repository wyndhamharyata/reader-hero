import { useEffect, useRef, useState } from "react";
import type { ReaderFont, ReaderSettings, ReaderTheme, TextAlign, TocEntry } from "@/domain/book";
import {
  AdjustmentsIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
} from "@/components/icons";

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

const alignments: ReadonlyArray<{ value: TextAlign; label: string; icon: typeof AlignLeftIcon }> = [
  { value: "left", label: "Align left", icon: AlignLeftIcon },
  { value: "justify", label: "Justify", icon: AlignJustifyIcon },
  { value: "right", label: "Align right", icon: AlignRightIcon },
];

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;
const MIN_LINE_HEIGHT = 0.6;
const MAX_LINE_HEIGHT = 2.0;

export function MenuSheet({
  open,
  toc,
  modeLabel,
  settings,
  onSelect,
  onToggleMode,
  onSettingsChange,
  onClose,
}: Props) {
  // Collapsed on phones so the contents list gets the sheet's height; open in the desktop sidebar.
  const [textOpen, setTextOpen] = useState(() => window.matchMedia("(width >= 48rem)").matches);
  const sheetRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  // Native listeners: React registers touchmove as passive, so it cannot stop the list's own bounce.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || sheet === null) return;
    let startY = 0;
    let startAt = 0;
    let offset = 0;
    let mode: "idle" | "drag" | "scroll" = "idle";

    const onStart = (event: TouchEvent) => {
      mode = window.matchMedia("(width >= 48rem)").matches ? "scroll" : "idle";
      startY = event.touches[0]?.clientY ?? 0;
      startAt = event.timeStamp;
      offset = 0;
    };
    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (mode === "scroll" || y === undefined) return;
      const dy = y - startY;
      if (mode === "idle") {
        const list = listRef.current;
        const inList = list !== null && list.contains(event.target as Node);
        mode = dy > 0 && (!inList || list.scrollTop <= 0) ? "drag" : "scroll";
        if (mode === "scroll") return;
        sheet.style.transition = "none";
      }
      event.preventDefault();
      offset = Math.max(0, dy);
      sheet.style.transform = `translateY(${offset}px)`;
    };
    const onEnd = (event: TouchEvent) => {
      if (mode !== "drag") return;
      mode = "idle";
      const flick = offset > 30 && offset / Math.max(1, event.timeStamp - startAt) > 0.5;
      sheet.style.transition = "transform 200ms ease-out";
      if (offset < 100 && !flick) {
        sheet.style.transform = "";
        return;
      }
      sheet.style.transform = "translateY(100%)";
      window.setTimeout(() => closeRef.current(), 200);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [open]);

  if (!open) return null;

  const smaller = Math.max(MIN_FONT_SIZE, settings.fontSize - 1);
  const larger = Math.min(MAX_FONT_SIZE, settings.fontSize + 1);
  // Round to one decimal so repeated 0.1 steps do not drift (1.6 + 0.1 is 1.7000000000000002).
  const tighter = Math.max(MIN_LINE_HEIGHT, Math.round((settings.lineHeight - 0.1) * 10) / 10);
  const looser = Math.min(MAX_LINE_HEIGHT, Math.round((settings.lineHeight + 0.1) * 10) / 10);

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end md:flex-row">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <aside
        ref={sheetRef}
        className="relative z-10 mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-box bg-base-100 p-4 pb-[calc(var(--safe-bottom)+0.25rem)] md:mx-0 md:h-full md:max-h-none md:w-80 md:max-w-[85%] md:rounded-none md:pt-[max(1rem,var(--safe-top))] md:pb-[var(--safe-bottom)]"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />

        <div className="hidden items-center justify-between md:order-1 md:flex">
          <h2 className="text-lg font-semibold">Menu</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:order-4 md:mt-4">
          <h3 className="text-sm font-semibold">Contents</h3>
          <ul
            ref={listRef}
            className="mt-1 flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            {toc.length === 0 && (
              <li className="p-2 text-sm opacity-70">No table of contents found.</li>
            )}
            {toc.map((entry, index) => (
              <li key={index} className="w-full shrink-0">
                <button
                  type="button"
                  className="w-full rounded-field px-2 py-2 text-left text-sm whitespace-normal hover:bg-base-200 md:py-1.5"
                  onClick={() => onSelect(entry.blockIndex)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <section className="mt-3 flex flex-col-reverse rounded-box border border-base-300 md:order-3 md:mt-2 md:flex-col">
          <button
            type="button"
            className="flex w-full items-center gap-2 p-3 text-sm font-medium"
            aria-expanded={textOpen}
            onClick={() => setTextOpen(!textOpen)}
          >
            <AdjustmentsIcon className="size-5 md:size-4" />
            <span className="flex-1 text-left">Text settings</span>
            <ChevronDownIcon
              className={`size-5 transition-transform md:size-4 ${textOpen ? "md:rotate-180" : "max-md:rotate-180"}`}
            />
          </button>

          {textOpen && (
            <div className="px-3 pt-3 md:pt-0 md:pb-3">
              <section>
                <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Theme</p>
                <div className="flex gap-2">
                  {themes.map((theme) => (
                    <button
                      key={theme.value}
                      type="button"
                      className={
                        settings.theme === theme.value ? "btn btn-active btn-sm" : "btn btn-sm"
                      }
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
                      className={
                        settings.font === font.value ? "btn btn-active btn-sm" : "btn btn-sm"
                      }
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
                <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">
                  Line spacing
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label="Less line spacing"
                    onClick={() => onSettingsChange({ lineHeight: tighter })}
                    disabled={settings.lineHeight <= MIN_LINE_HEIGHT}
                  >
                    −
                  </button>
                  <span className="w-12 text-center text-sm">{settings.lineHeight.toFixed(1)}</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label="More line spacing"
                    onClick={() => onSettingsChange({ lineHeight: looser })}
                    disabled={settings.lineHeight >= MAX_LINE_HEIGHT}
                  >
                    +
                  </button>
                </div>
              </section>

              <section className="mt-3">
                <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">
                  Alignment
                </p>
                <div className="flex gap-2">
                  {alignments.map((alignment) => (
                    <button
                      key={alignment.value}
                      type="button"
                      className={
                        settings.textAlign === alignment.value
                          ? "btn btn-active btn-square btn-sm"
                          : "btn btn-square btn-sm"
                      }
                      aria-label={alignment.label}
                      aria-pressed={settings.textAlign === alignment.value}
                      onClick={() => onSettingsChange({ textAlign: alignment.value })}
                    >
                      <alignment.icon className="size-5 md:size-4" />
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-3 hidden md:block">
                <p className="mb-2 flex justify-between text-xs font-medium tracking-wide uppercase opacity-60">
                  <span>Line width</span>
                  <span className="normal-case">{settings.textWidth} ch</span>
                </p>
                <input
                  type="range"
                  className="range w-full range-sm"
                  min={40}
                  max={120}
                  step={5}
                  value={settings.textWidth}
                  aria-label="Line width"
                  onChange={(event) => onSettingsChange({ textWidth: Number(event.target.value) })}
                />
              </section>
            </div>
          )}
        </section>

        <div className="mt-3 flex gap-2 md:order-2 md:mt-2">
          <button
            type="button"
            className="btn flex-1 md:justify-start md:btn-ghost"
            onClick={onToggleMode}
          >
            <BookOpenIcon className="size-5 md:size-4" />
            {modeLabel}
          </button>
          <button type="button" className="btn btn-ghost md:hidden" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
