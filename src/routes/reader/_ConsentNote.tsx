import type { ReactElement } from "react";
import { providerLabels, type AiProvider } from "@/domain/ai";

interface Props {
  provider: AiProvider;
  onCancel: () => void;
  onAllow: () => void;
}

// Shown once per provider before the first action sends text; Allow records the consent.
export function ConsentNote({ provider, onCancel, onAllow }: Props): ReactElement {
  const name = providerLabels[provider];
  return (
    <div className="mt-3 flex min-h-0 flex-col gap-3">
      <p className="text-base font-medium md:text-sm">Text sent to {name}</p>
      <p className="text-base md:text-sm">
        Each AI action sends the chosen passage to {name} with the stored key. Reader Hero's own
        server receives neither the text nor the key. {name}'s terms apply to the text it receives.
        Results are stored on this device and read offline.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost md:btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary md:btn-sm" onClick={onAllow}>
          Allow
        </button>
      </div>
    </div>
  );
}
