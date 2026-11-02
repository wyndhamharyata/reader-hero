import type { ReactElement } from "react";
import { providerLabels, relayedProviders, type AiProvider } from "@/domain/ai";

// Shown once per provider before the first action sends text. Allow, or the setup's own key, records the consent.
export function ConsentNote({
  provider,
  onCancel,
  onAllow,
}: {
  readonly provider: AiProvider;
  // Unset inside the first setup, where its own key agrees.
  readonly onCancel?: () => void;
  readonly onAllow?: () => void;
}): ReactElement {
  const name = providerLabels[provider];
  // A custom URL has no name of its own, so the note points at the field that holds it.
  const target = provider === "compatible" ? "the provider at your base URL" : name;
  const isRelayed = relayedProviders.has(provider);

  return (
    // The note takes the panel's width and never sets it.
    <div className="flex flex-col gap-3 [contain:inline-size]">
      <div className="rounded-xl border border-(--green)/25 bg-(--green-wash) p-4 text-sm leading-normal">
        {isRelayed ? (
          <p>
            Reader Hero sends your book's text with your key to {target}. It goes through our relay,
            a Cloudflare Worker that passes each request on and keeps nothing.
          </p>
        ) : (
          <p>
            Reader Hero sends your book's text to {name} with your key, straight from this device.
            Our server never sees it.
          </p>
        )}
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Each chapter it summarises, with the summary of the chapter before.</li>
          <li>
            Your summaries and character list, when it updates the names, writes a series paragraph
            or answers a question you ask.
          </li>
          <li>The summaries and characters of earlier books in a series.</li>
          <li>
            With Series grouping on, each new book's title, author, file name and first 200 words.
          </li>
          <li>Rebuild, in Settings, sends these again for every book it writes again.</li>
        </ul>
        <p className="mt-2">
          {isRelayed ? "The provider's" : `${name}'s`} terms cover what it receives.
        </p>
      </div>
      {onAllow !== undefined && (
        <div className="flex justify-end gap-2.5">
          {onCancel !== undefined && (
            <button type="button" className="key small" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="key small green" onClick={onAllow}>
            Allow
          </button>
        </div>
      )}
    </div>
  );
}
