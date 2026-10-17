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
            a Cloudflare Worker that passes each request on and keeps nothing.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium md:text-sm">Text sent to {name}</p>
          <p className="text-base md:text-sm">
            Reader Hero sends your book's text to {name} with your key, straight from this device.
            Our server never sees it.
          </p>
        </>
      )}
      {/* Every kind of request, so the note covers what the app sends and not only the chapters. */}
      <ul className="list-disc space-y-1 pl-5 text-base md:text-sm">
        <li>Each chapter it summarises, with the summary of the chapter before.</li>
        <li>
          Your summaries and character list, when it updates the names, writes a series paragraph or
          answers a question you ask.
        </li>
        <li>The summaries and characters of earlier books in a series.</li>
        <li>
          With Series grouping on, each new book's title, author, file name and first 200 words.
        </li>
        <li>Rebuild, in Settings, sends these again for every book it writes again.</li>
      </ul>
      <p className="text-base md:text-sm">
        {relayedProviders.has(provider) ? "The provider's" : `${name}'s`} terms cover what it
        receives.
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
