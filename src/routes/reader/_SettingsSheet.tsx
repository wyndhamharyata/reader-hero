import type { ReaderFont, ReaderSettings, ReaderTheme } from "@/domain/book";

interface Props {
  open: boolean;
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
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

export function SettingsSheet({ open, settings, onChange, onClose }: Props) {
  if (!open) return null;

  const themeClass = (value: ReaderTheme): string =>
    settings.theme === value ? "btn btn-sm btn-active" : "btn btn-sm";
  const fontClass = (value: ReaderFont): string =>
    settings.font === value ? "btn btn-sm btn-active" : "btn btn-sm";
  const lineHeightClass = (value: number): string =>
    settings.lineHeight === value ? "btn btn-sm btn-active" : "btn btn-sm";

  const smaller = Math.max(MIN_FONT_SIZE, settings.fontSize - 1);
  const larger = Math.min(MAX_FONT_SIZE, settings.fontSize + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-box bg-base-100 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Reading settings</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Done
          </button>
        </div>

        <section className="mt-4">
          <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Theme</p>
          <div className="flex gap-2">
            {themes.map((theme) => (
              <button
                key={theme.value}
                type="button"
                className={themeClass(theme.value)}
                onClick={() => onChange({ theme: theme.value })}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Font</p>
          <div className="flex gap-2">
            {fonts.map((font) => (
              <button
                key={font.value}
                type="button"
                className={fontClass(font.value)}
                onClick={() => onChange({ font: font.value })}
              >
                {font.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Size</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onChange({ fontSize: smaller })}
              disabled={settings.fontSize <= MIN_FONT_SIZE}
            >
              A-
            </button>
            <span className="w-12 text-center text-sm">{settings.fontSize}px</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onChange({ fontSize: larger })}
              disabled={settings.fontSize >= MAX_FONT_SIZE}
            >
              A+
            </button>
          </div>
        </section>

        <section className="mt-4">
          <p className="mb-2 text-xs font-medium tracking-wide uppercase opacity-60">Line spacing</p>
          <div className="flex gap-2">
            {lineHeights.map((height) => (
              <button
                key={height}
                type="button"
                className={lineHeightClass(height)}
                onClick={() => onChange({ lineHeight: height })}
              >
                {height}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
