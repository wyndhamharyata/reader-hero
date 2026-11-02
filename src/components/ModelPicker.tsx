import type { ReactElement } from "react";
import { ChevronDownIcon } from "@/components/icons";
import type { ModelInfo } from "@/lib/ai-transport";

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
    <div>
      <label className="field-label" htmlFor="provider-model">
        Model
      </label>
      {/* A provider's list can leave models out, as Z.ai's does its free ones, so the field also takes a typed id. */}
      <div className="relative">
        <div className="field font-mono text-sm">
          <input
            id="provider-model"
            type="text"
            role="combobox"
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
            className="key small square"
            aria-label="Show models"
            disabled={models.length === 0}
            // Keeps the focus in the field, so its blur does not close the list this opens.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFilterChange(filter === null ? "" : null)}
          >
            <ChevronDownIcon className="icon size-4" />
          </button>
        </div>
        {filter !== null && models.length > 0 && (
          <ul
            id="provider-models"
            role="listbox"
            aria-label="Models"
            className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-xl border border-(--line) bg-(--surface) p-1 shadow-lg"
          >
            {models
              .filter((entry) => entry.id.includes(filter.trim()))
              .map((entry) => {
                const optionClass = `cursor-pointer rounded-lg px-3 py-2 font-mono text-sm ${entry.id === model ? "bg-(--sunk) font-semibold" : "hover:bg-(--sunk)"}`;

                return (
                  <li
                    key={entry.id}
                    role="option"
                    aria-selected={entry.id === model}
                    className={optionClass}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onModelChange(entry.id);
                      onFilterChange(null);
                    }}
                  >
                    {entry.id}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}
