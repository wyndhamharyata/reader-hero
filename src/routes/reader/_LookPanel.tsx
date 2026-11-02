import { useEffect, useRef, useState, type ReactElement } from "react";
import { Panel } from "@/components/Panel";
import type { ReaderFont, ReaderSettings, ReaderTheme, TextAlign } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

const fonts: ReadonlyArray<{ value: ReaderFont; label: string }> = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
];

const themes: ReadonlyArray<{ value: ReaderTheme; label: string; className: string }> = [
  {
    value: "rhlight",
    label: "Light",
    className: "bg-[oklch(98%_0.008_85)] [background-image:var(--fibre)] text-[#2a2620]",
  },
  {
    value: "rhdark",
    label: "Dark",
    className: "bg-[oklch(19%_0.006_85)] [background-image:var(--grain)] text-[#e6e1d8]",
  },
];

const alignments: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: "left", label: "Left" },
  { value: "justify", label: "Justify" },
  { value: "right", label: "Right" },
];

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;
const MIN_LINE_HEIGHT = 0.6;
const MAX_LINE_HEIGHT = 2.0;
// The page recolours every block of a book, so a drag recolours it once the finger rests.
const warmthRestMs = 150;
// Within this of neutral the thumb snaps to it, so neutral is easy to find again.
const neutralCatch = 0.05;

// One decimal, so repeated 0.1 steps do not drift (1.6 + 0.1 is 1.7000000000000002).
function stepLineHeight(lineHeight: number, by: number): number {
  const next = Math.round((lineHeight + by) * 10) / 10;

  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, next));
}

function Stepper({
  value,
  less,
  more,
  canLess,
  canMore,
  onLess,
  onMore,
}: {
  readonly value: string;
  readonly less: string;
  readonly more: string;
  readonly canLess: boolean;
  readonly canMore: boolean;
  readonly onLess: () => void;
  readonly onMore: () => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <button type="button" className="key small" disabled={!canLess} onClick={onLess}>
        {less}
      </button>
      <output className="min-w-9 text-center font-bold tabular-nums">{value}</output>
      <button type="button" className="key small" disabled={!canMore} onClick={onMore}>
        {more}
      </button>
    </div>
  );
}

// Every change shows on the page at once, so the scrim is clear and the page stays in view.
export function LookPanel({
  settings,
  view,
  onView,
  onChange,
  onClose,
}: {
  readonly settings: ReaderSettings;
  readonly view: "look" | "more";
  readonly onView: (view: "look" | "more") => void;
  readonly onChange: (patch: Partial<ReaderSettings>) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  // Held until the saved value comes back, so the thumb does not jump back for a frame.
  const [warmth, setWarmth] = useState<number | null>(null);
  const rest = useRef(0);
  const slider = useRef<HTMLInputElement>(null);

  if (warmth !== null && warmth === settings.temperature) setWarmth(null);

  useEffect(() => () => window.clearTimeout(rest.current), []);
  // The native change comes once, on release or on a key press, so a drag saves once.
  useEffect(() => {
    const node = slider.current;

    if (node === null) return;

    const save = (): void => {
      const value = Number(node.value);

      onChange({ temperature: Math.abs(value) < neutralCatch ? 0 : value });
    };

    node.addEventListener("change", save);

    return () => node.removeEventListener("change", save);
  }, [onChange, view]);

  const fontSize = settings.fontSize;
  const panelProps = {
    sheetRef,
    backdropRef,
    label: "Look",
    title: "Look",
    docks: true,
    isClear: true,
    onDismiss: () => dismiss(),
  };

  if (view === "more") {
    return (
      <Panel {...panelProps} onBack={() => onView("look")}>
        <div className="rows">
          <div className="row-item">
            <span className="row-label">Line spacing</span>
            <Stepper
              value={settings.lineHeight.toFixed(1)}
              less="−"
              more="+"
              canLess={settings.lineHeight > MIN_LINE_HEIGHT}
              canMore={settings.lineHeight < MAX_LINE_HEIGHT}
              onLess={() => onChange({ lineHeight: stepLineHeight(settings.lineHeight, -0.1) })}
              onMore={() => onChange({ lineHeight: stepLineHeight(settings.lineHeight, 0.1) })}
            />
          </div>
          <div className="row-item">
            <span className="row-label">Alignment</span>
            <div className="latch-row" role="group" aria-label="Alignment">
              {alignments.map((alignment) => (
                <button
                  key={alignment.value}
                  type="button"
                  className="key"
                  aria-pressed={settings.textAlign === alignment.value}
                  onClick={() => onChange({ textAlign: alignment.value })}
                >
                  {alignment.label}
                </button>
              ))}
            </div>
          </div>
          {/* A phone's page is as wide as its screen, so only wider screens choose a width. */}
          <label className="row-item hidden md:flex">
            <span className="row-label w-24 flex-none">Line width</span>
            <input
              type="range"
              className="fader"
              min={40}
              max={120}
              step={5}
              value={settings.textWidth}
              onChange={(event) => onChange({ textWidth: Number(event.target.value) })}
            />
          </label>
        </div>
      </Panel>
    );
  }

  return (
    <Panel {...panelProps}>
      <div className="flex gap-2.5" role="group" aria-label="Theme">
        {themes.map((theme) => (
          <button
            key={theme.value}
            type="button"
            className={`grid h-16 flex-1 place-items-center rounded-[10px] font-serif text-lg font-semibold shadow-[0_0_0_1px_oklch(0%_0_0/0.12),0_2px_0_oklch(0%_0_0/0.12),0_4px_8px_-3px_oklch(0%_0_0/0.3)] aria-pressed:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--green)] ${theme.className}`}
            aria-label={theme.label}
            aria-pressed={settings.theme === theme.value}
            onClick={() => onChange({ theme: theme.value })}
          >
            Aa
          </button>
        ))}
      </div>
      <label className="mt-4.5 flex items-center gap-3">
        <span className="w-23 flex-none text-sm font-semibold text-(--ink-soft)">Warmth</span>
        <input
          ref={slider}
          type="range"
          className="fader warmth"
          min={-1}
          max={1}
          step={0.01}
          value={warmth ?? settings.temperature}
          onChange={(event) => {
            const value = Number(event.target.value);
            const next = Math.abs(value) < neutralCatch ? 0 : value;

            setWarmth(next);
            window.clearTimeout(rest.current);
            rest.current = window.setTimeout(
              () => document.documentElement.style.setProperty("--temperature", String(next)),
              warmthRestMs,
            );
          }}
        />
      </label>
      <div className="mt-4.5 flex items-center gap-3">
        <span className="w-23 flex-none text-sm font-semibold text-(--ink-soft)">Size</span>
        <Stepper
          value={String(fontSize)}
          less="A−"
          more="A+"
          canLess={fontSize > MIN_FONT_SIZE}
          canMore={fontSize < MAX_FONT_SIZE}
          onLess={() => onChange({ fontSize: fontSize - 1 })}
          onMore={() => onChange({ fontSize: fontSize + 1 })}
        />
      </div>
      <div className="mt-4.5 flex gap-2" role="group" aria-label="Font">
        {fonts.map((font) => (
          <button
            key={font.value}
            type="button"
            className="key min-h-14.5 flex-1 flex-col gap-0 text-[11.5px] font-semibold"
            aria-pressed={settings.font === font.value}
            onClick={() => onChange({ font: font.value })}
          >
            <b className="text-xl leading-tight font-semibold" data-font={font.value}>
              Aa
            </b>
            {font.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="row-item mt-4.5 rounded-[14px] border border-(--line)"
        onClick={() => onView("more")}
      >
        <span className="row-label">More</span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
    </Panel>
  );
}
