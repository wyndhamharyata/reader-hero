import type { ReactElement } from "react";
import { AlignJustifyIcon, AlignLeftIcon, AlignRightIcon } from "@/components/icons";
import type { ReaderFont, ReaderSettings, ReaderTheme, TextAlign } from "@/domain/book";

interface Props {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
}

const themes: ReadonlyArray<{ value: ReaderTheme; label: string }> = [
  { value: "rhlight", label: "Light" },
  { value: "rhsepia", label: "Sepia" },
  { value: "rhdark", label: "Dark" },
];

const fonts: ReadonlyArray<{ value: ReaderFont; label: string }> = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
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

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";
// The panel sits on base-200, so unchosen buttons lift to base-100; the chosen one is neutral.
const choice = (chosen: boolean): string =>
  chosen ? "btn btn-neutral md:btn-sm" : "btn bg-base-100 md:btn-sm";

export function TextSettings({ settings, onChange }: Props): ReactElement {
  const smaller = Math.max(MIN_FONT_SIZE, settings.fontSize - 1);
  const larger = Math.min(MAX_FONT_SIZE, settings.fontSize + 1);
  // One decimal, so repeated 0.1 steps do not drift (1.6 + 0.1 is 1.7000000000000002).
  const tighter = Math.max(MIN_LINE_HEIGHT, Math.round((settings.lineHeight - 0.1) * 10) / 10);
  const looser = Math.min(MAX_LINE_HEIGHT, Math.round((settings.lineHeight + 0.1) * 10) / 10);

  return (
    <div className="px-3 pt-3 md:pt-0 md:pb-3">
      <section>
        <p className={heading}>Theme</p>
        <div className="flex gap-2">
          {themes.map((theme) => {
            const themeClass = choice(settings.theme === theme.value);
            return (
              <button
                key={theme.value}
                type="button"
                className={themeClass}
                onClick={() => onChange({ theme: theme.value })}
              >
                {theme.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-3">
        <p className={heading}>Font</p>
        <div className="flex gap-2">
          {fonts.map((font) => {
            const fontClass = choice(settings.font === font.value);
            return (
              <button
                key={font.value}
                type="button"
                className={fontClass}
                data-font={font.value}
                onClick={() => onChange({ font: font.value })}
              >
                {font.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Side by side on phones, which saves a row of height in the bottom sheet. */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:block">
        <section>
          <p className={heading}>Size</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-base-100 md:btn-sm"
              onClick={() => onChange({ fontSize: smaller })}
              disabled={settings.fontSize <= MIN_FONT_SIZE}
            >
              A-
            </button>
            <span className="w-10 text-center text-base md:w-12 md:text-sm">
              {settings.fontSize}px
            </span>
            <button
              type="button"
              className="btn bg-base-100 md:btn-sm"
              onClick={() => onChange({ fontSize: larger })}
              disabled={settings.fontSize >= MAX_FONT_SIZE}
            >
              A+
            </button>
          </div>
        </section>

        <section className="md:mt-3">
          <p className={heading}>Line spacing</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-base-100 md:btn-sm"
              aria-label="Less line spacing"
              onClick={() => onChange({ lineHeight: tighter })}
              disabled={settings.lineHeight <= MIN_LINE_HEIGHT}
            >
              −
            </button>
            <span className="w-10 text-center text-base md:w-12 md:text-sm">
              {settings.lineHeight.toFixed(1)}
            </span>
            <button
              type="button"
              className="btn bg-base-100 md:btn-sm"
              aria-label="More line spacing"
              onClick={() => onChange({ lineHeight: looser })}
              disabled={settings.lineHeight >= MAX_LINE_HEIGHT}
            >
              +
            </button>
          </div>
        </section>
      </div>

      <section className="mt-3">
        <p className={heading}>Alignment</p>
        <div className="flex gap-2">
          {alignments.map((alignment) => {
            const chosen = settings.textAlign === alignment.value;
            const alignClass = `${choice(chosen)} btn-square`;
            return (
              <button
                key={alignment.value}
                type="button"
                className={alignClass}
                aria-label={alignment.label}
                aria-pressed={chosen}
                onClick={() => onChange({ textAlign: alignment.value })}
              >
                <alignment.icon className="size-6 md:size-4" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-3 hidden md:block">
        <p className={`${heading} flex justify-between`}>
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
          onChange={(event) => onChange({ textWidth: Number(event.target.value) })}
        />
      </section>
    </div>
  );
}
