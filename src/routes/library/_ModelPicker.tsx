import type { ReactElement } from "react";
import { ChevronDownIcon } from "@/components/icons";
import type { ModelInfo } from "@/lib/ai-transport";
import { settingsHeading } from "./_settings-shared";

export function ModelPicker({
  model,
  models,
  filter,
  onModelChange,
  onFilterChange,
}: {
  readonly model: string;
  readonly models: ReadonlyArray<ModelInfo>;
  readonly filter: string | null;
  readonly onModelChange: (model: string) => void;
  readonly onFilterChange: (filter: string | null) => void;
}): ReactElement {
  return (
    <section className="mt-3 px-4">
      <p className={settingsHeading}>Model</p>
      {/* A provider's list can leave models out, as Z.ai's does its free ones, so the field also takes a typed id. */}
      <div className="relative">
        <label className="input w-full pr-1 text-base md:text-sm">
          <input
            type="text"
            role="combobox"
            aria-label="Model"
            aria-expanded={filter !== null}
            aria-controls="provider-models"
            placeholder="Model"
            autoComplete="off"
            value={model}
            onChange={(event) => {
              onModelChange(event.target.value);
              onFilterChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") onFilterChange("");

              if (event.key === "Escape" && filter !== null) {
                event.stopPropagation();
                onFilterChange(null);
              }
            }}
            onBlur={() => onFilterChange(null)}
          />
          <button
            type="button"
            className="btn btn-square btn-ghost btn-sm"
            aria-label="Show models"
            disabled={models.length === 0}
            // Keeps the focus in the field, so its blur does not close the list this opens.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFilterChange(filter === null ? "" : null)}
          >
            <ChevronDownIcon className="size-4" />
          </button>
        </label>
        {filter !== null && models.length > 0 && (
          <ul
            id="provider-models"
            role="listbox"
            aria-label="Models"
            className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
          >
            {models
              .filter((entry) => entry.id.includes(filter.trim()))
              .map((entry) => (
                <li
                  key={entry.id}
                  role="option"
                  aria-selected={entry.id === model}
                  className={`cursor-pointer rounded-field px-3 py-2 text-base md:py-1.5 md:text-sm ${entry.id === model ? "bg-base-200 font-medium" : "hover:bg-base-200"}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onModelChange(entry.id);
                    onFilterChange(null);
                  }}
                >
                  {entry.id}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
