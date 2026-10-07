import type { ReactElement } from "react";
import type { ReaderSettings } from "@/domain/book";

interface Props {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
}

const heading = "mb-2 text-xs font-medium tracking-wide uppercase opacity-60";

// Shared by Text settings and the library's Settings; on a base-300 panel, so unchosen are base-100.
export function ThemeControls({ settings, onChange }: Props): ReactElement {
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
            {settings.temperature === 0 ? "Neutral" : settings.temperature < 0 ? "Cool" : "Warm"}
          </span>
        </p>
        {/* The track shows the scale itself; no fill, since neutral sits in the middle. */}
        <input
          type="range"
          className="range w-full bg-[linear-gradient(to_right,oklch(62%_0.13_250),oklch(80%_0_0),oklch(62%_0.15_50))] bg-size-[100%_50%] bg-center bg-no-repeat [--range-bg:transparent] [--range-fill:0] md:range-sm"
          min={-1}
          max={1}
          step={0.1}
          value={settings.temperature}
          aria-label="Temperature"
          onChange={(event) =>
            onChange({ temperature: Math.round(Number(event.target.value) * 10) / 10 })
          }
        />
      </section>
    </>
  );
}
