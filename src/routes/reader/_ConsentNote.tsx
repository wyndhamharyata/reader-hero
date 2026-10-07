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
      <p className="text-sm font-medium">Text sent to {name}</p>
      <p className="text-sm">
        Each AI action sends the chosen passage to {name} with the stored key. Reader Hero's own
        server receives neither the text nor the key. {name}'s terms apply to the text it receives.
        Results are stored on this device and read offline.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAllow}>
          Allow
        </button>
      </div>
    </div>
  );
}
