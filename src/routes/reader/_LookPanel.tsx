import { useRef, useState, type ReactElement } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import { ThemeControls } from "@/components/ThemeControls";
import type { ReaderFont, ReaderSettings, TextAlign } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

const fonts: ReadonlyArray<{ value: ReaderFont; label: string }> = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
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
  onChange,
  onClose,
}: {
  readonly settings: ReaderSettings;
  readonly onChange: (patch: Partial<ReaderSettings>) => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  // A phone folds the finer settings away. A wider screen has the room and shows them.
  const [isMoreOpen, setMoreOpen] = useState(false);
  const fontSize = settings.fontSize;

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Look"
      title="Look"
      docks
      isClear
      onDismiss={() => dismiss()}
    >
      <ThemeControls settings={settings} onChange={onChange} />
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
      <div className="rows mt-4.5">
        <button
          type="button"
          className="row-item md:hidden"
          aria-expanded={isMoreOpen}
          onClick={() => setMoreOpen(!isMoreOpen)}
        >
          <span className="row-label">More</span>
          <ChevronDownIcon
            className={`icon size-4.5 text-(--ink-soft) transition-transform ${isMoreOpen ? "rotate-180" : ""}`}
          />
        </button>
        <div className={isMoreOpen ? "contents" : "hidden md:contents"}>
          {/* The wrapper is not in the layout, so the rule between rows needs drawing here on a phone. */}
          <div className="row-item max-md:border-t max-md:border-(--line)">
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
      </div>
    </Panel>
  );
}
