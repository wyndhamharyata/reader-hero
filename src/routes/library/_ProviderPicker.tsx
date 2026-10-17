import { useState, type ReactElement } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { AiProvider, providerLabels, relayedProviders } from "@/domain/ai";

interface Props {
  value: AiProvider;
  onChange: (next: AiProvider) => void;
}

// The custom URL stands alone at the end, so it is not in a group.
const groups: ReadonlyArray<{
  readonly label: string;
  readonly ids: ReadonlyArray<AiProvider>;
}> = [
  {
    label: "Direct",
    ids: AiProvider.literals.filter((id) => id !== "compatible" && !relayedProviders.has(id)),
  },
  {
    label: "Through our relay",
    ids: AiProvider.literals.filter((id) => id !== "compatible" && relayedProviders.has(id)),
  },
];

function Choice({
  id,
  label,
  isSelected,
  onPick,
}: {
  readonly id: AiProvider;
  readonly label: string;
  readonly isSelected: boolean;
  readonly onPick: (id: AiProvider) => void;
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-isSelected={isSelected}
        className={`w-full cursor-pointer rounded-field px-3 py-2 text-left text-base md:py-1.5 md:text-sm ${isSelected ? "bg-base-200 font-medium" : "hover:bg-base-200"}`}
        onClick={() => onPick(id)}
      >
        {label}
      </button>
    </li>
  );
}

// A native select draws its group heading as close to the options as one more option, so this list draws its own.
export function ProviderPicker({ value, onChange }: Props): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const pick = (id: AiProvider): void => {
    onChange(id);
    setIsOpen(false);
  };

  return (
    <div
      className="relative"
      // A tap anywhere outside closes the list. A tap on an option keeps it open until the pick arrives.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-label="Provider"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="provider-list"
        className="input flex w-full items-center justify-between gap-2 text-left text-base md:text-sm"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setIsOpen(true);
          if (event.key === "Escape") setIsOpen(false);
        }}
      >
        {providerLabels[value]}
        <ChevronDownIcon className="size-4 shrink-0 opacity-60" />
      </button>
      {isOpen && (
        <ul
          id="provider-list"
          role="listbox"
          aria-label="Provider"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
        >
          {groups.map((group, index) => (
            <li
              key={group.label}
              role="group"
              aria-label={group.label}
              className={index === 0 ? "" : "mt-1 border-t border-base-300 pt-1"}
            >
              <p
                aria-hidden="true"
                className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide uppercase opacity-60"
              >
                {group.label}
              </p>
              <ul>
                {group.ids.map((id) => (
                  <Choice
                    key={id}
                    id={id}
                    label={providerLabels[id]}
                    isSelected={id === value}
                    onPick={pick}
                  />
                ))}
              </ul>
            </li>
          ))}
          <li className="mt-1 border-t border-base-300 pt-1">
            <Choice
              id="compatible"
              label="Other (own URL)"
              isSelected={value === "compatible"}
              onPick={pick}
            />
          </li>
        </ul>
      )}
    </div>
  );
}
