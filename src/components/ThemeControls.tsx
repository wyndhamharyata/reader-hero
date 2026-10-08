import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ReaderSettings } from "@/domain/book";

interface Props {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
}

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

// Shared by Text settings and the library's Settings; on a base-300 panel, so unchosen are base-100.
export function ThemeControls({ settings, onChange }: Props): ReactElement {
  // A drag saves once, on release: a save renders the whole book again.
  const [draft, setDraft] = useState<number | null>(null);
  // Held until the saved value comes back, so the thumb does not jump back for a frame.
  if (draft !== null && draft === settings.temperature) setDraft(null);
  const temperature = draft ?? settings.temperature;
  const slider = useRef<HTMLInputElement>(null);
  const rest = useRef(0);
  useEffect(() => {
    const node = slider.current;
    if (node === null) return;
    // The native change comes once, on release or on a key press.
    const save = (): void => onChange({ temperature: Number(node.value) });
    node.addEventListener("change", save);
    return () => node.removeEventListener("change", save);
  }, [onChange]);
  // Once saved, the sheet takes the page's temperature again.
  useEffect(() => {
    const box = slider.current?.closest<HTMLElement>("[data-theme]");
    if (draft === null && box !== document.documentElement)
      box?.style.removeProperty("--temperature");
  }, [draft]);
  useEffect(() => () => window.clearTimeout(rest.current), []);

  return (
    <>
      <section>
        <p className={heading}>Theme</p>
        <div className="flex gap-2">
          {(
            [
              { value: "rhlight", label: "Light" },
              { value: "rhdark", label: "Dark" },
            ] as const
          ).map((theme) => (
            <button
              key={theme.value}
              type="button"
              className={`btn md:btn-sm ${settings.theme === theme.value ? "btn-neutral" : "bg-base-100"}`}
              aria-pressed={settings.theme === theme.value}
              onClick={() => onChange({ theme: theme.value })}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-3">
        <p className={`${heading} flex justify-between`}>
          <span>Temperature</span>
          <span className="normal-case">
            {temperature === 0 ? "Neutral" : temperature < 0 ? "Cool" : "Warm"}
          </span>
        </p>
        {/* The track shows the scale itself; no fill, since neutral sits in the middle. */}
        <input
          ref={slider}
          type="range"
          className="range w-full bg-[linear-gradient(to_right,oklch(62%_0.13_250),oklch(80%_0_0),oklch(62%_0.15_50))] bg-size-[100%_50%] bg-center bg-no-repeat [--range-bg:transparent] [--range-fill:0] md:range-sm"
          min={-1}
          max={1}
          step={0.01}
          value={temperature}
          aria-label="Temperature"
          onChange={(event) => {
            const value = Number(event.target.value);
            // Fine steps, with a catch around neutral so it is easy to find again.
            const next = Math.abs(value) < 0.05 ? 0 : value;
            setDraft(next);
            // The sheet follows the thumb; the page, which recolours every block of a book, once the finger rests.
            event.target
              .closest<HTMLElement>("[data-theme]")
              ?.style.setProperty("--temperature", String(next));
            window.clearTimeout(rest.current);
            rest.current = window.setTimeout(
              () => document.documentElement.style.setProperty("--temperature", String(next)),
              150,
            );
          }}
        />
      </section>
    </>
  );
}
