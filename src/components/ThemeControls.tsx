import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ReaderSettings, ReaderTheme } from "@/domain/book";
import { prefersLessMotion } from "@/lib/open-book";

const themes: ReadonlyArray<{ value: ReaderTheme; label: string; className: string }> = [
  {
    value: "rhlight",
    label: "Light",
    className: "bg-[oklch(98%_0.008_85)] [background-image:var(--fibre)] text-[#2a2620]",
  },
  {
    value: "rhdim",
    label: "Dim",
    className: "bg-[oklch(85%_0.005_85)] [background-image:var(--fibre)] text-[#2a2620]",
  },
  {
    value: "rhdark",
    label: "Dark",
    className: "bg-[oklch(19%_0.006_85)] [background-image:var(--grain)] text-[#e6e1d8]",
  },
];

// The page recolours every block of a book, so a drag recolours it once the finger rests.
const warmthRestMs = 150;
// Within this of neutral the thumb snaps to it, so neutral is easy to find again.
const neutralCatch = 0.05;

// The whole screen cross-fades to the other theme, then the choice saves.
function crossFadeTo(theme: ReaderTheme): void {
  const apply = (): void => {
    document.documentElement.dataset.theme = theme;
  };

  if ("startViewTransition" in document && !prefersLessMotion()) {
    void document.startViewTransition(apply);
    return;
  }

  apply();
}

// Theme and warmth, one global choice for every book. In the reader's Look and the library's Settings.
export function ThemeControls({
  settings,
  onChange,
}: {
  readonly settings: ReaderSettings;
  readonly onChange: (patch: Partial<ReaderSettings>) => void;
}): ReactElement {
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
  }, [onChange]);

  return (
    <>
      <div className="flex gap-2.5" role="group" aria-label="Theme">
        {themes.map((theme) => (
          <button
            key={theme.value}
            type="button"
            className={`grid h-16 flex-1 place-items-center rounded-[10px] font-serif text-lg font-semibold shadow-[0_0_0_1px_oklch(0%_0_0/0.12),0_2px_0_oklch(0%_0_0/0.12),0_4px_8px_-3px_oklch(0%_0_0/0.3)] aria-pressed:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--green)] ${theme.className}`}
            aria-label={theme.label}
            aria-pressed={settings.theme === theme.value}
            onClick={() => {
              crossFadeTo(theme.value);
              onChange({ theme: theme.value });
            }}
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
    </>
  );
}
