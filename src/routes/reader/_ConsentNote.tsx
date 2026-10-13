import type { ReactElement } from "react";
import { providerLabels, relayedProviders, type AiProvider } from "@/domain/ai";

interface Props {
  provider: AiProvider;
  onCancel: () => void;
  onAllow: () => void;
}

// Shown once per provider before the first action sends text; Allow records the consent.
export function ConsentNote({ provider, onCancel, onAllow }: Props): ReactElement {
  const name = providerLabels[provider];
  // A custom URL has no name of its own, so the note points at the field that holds it.
  const target = provider === "compatible" ? "the provider at your base URL" : name;
  return (
    // The note takes the sheet's width and never sets it, so its text cannot widen a reader sheet.
    <div className="mt-3 flex min-h-0 flex-col gap-3 [contain:inline-size]">
      {relayedProviders.has(provider) ? (
        <>
          <p className="text-base font-medium md:text-sm">Text sent through the relay</p>
          <p className="text-base md:text-sm">
            Reader Hero sends your book's text with your key to {target}. It goes through our relay,
            a Cloudflare Worker that passes each request on and keeps nothing. Series grouping also
            sends each new book's title, author, file name and first 200 words. Your summaries stay
            on this device, and the provider's terms cover what it receives.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium md:text-sm">Text sent to {name}</p>
          <p className="text-base md:text-sm">
            Reader Hero sends your book's text to {name} with your key, straight from this device.
            Our server never sees it. Series grouping also sends each new book's title, author, file
            name and first 200 words. Your summaries stay on this device, and {name}'s terms cover
            what it receives.
          </p>
        </>
      )}
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
