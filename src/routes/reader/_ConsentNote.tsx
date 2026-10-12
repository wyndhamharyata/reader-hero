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
    // The note takes the sheet's width and never sets it, so a long note cannot widen a reader sheet.
    <div className="mt-3 flex min-h-0 flex-col gap-3 [contain:inline-size]">
      <p className="text-base font-medium md:text-sm">Text sent to {name}</p>
      <p className="text-base md:text-sm">
        Reader Hero sends your text straight to {name} with your key. Reader Hero's server never
        sees your text or your key.
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-base md:text-sm">
        <li>Chapter summary: that chapter, in one request.</li>
        <li>A question: the summary already stored.</li>
        <li>
          Series grouping: each new book's title, author, file name and first 200 words, and the
          series already stored for the author.
        </li>
        <li>A series summary: the stored chapter summaries of one started book, in one request.</li>
        <li>A later book's character list: the characters stored for the earlier books.</li>
        <li>Automatic summary: each chapter as you read it.</li>
      </ul>
      <p className="text-base md:text-sm">
        {name}'s terms cover the text it receives. Your summaries stay on this device and read
        offline.
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
