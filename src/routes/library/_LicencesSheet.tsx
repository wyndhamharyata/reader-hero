import { useEffect, useRef, useState, type ReactElement } from "react";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

// The list holds every licence text, so it loads when the sheet opens and not at launch.
export function LicencesSheet({ onClose }: { onClose: () => void }): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);
  const [licences, setLicences] = useState<ReadonlyArray<{
    name: string;
    version: string;
    licence: string;
    text: string;
  }> | null>(null);

  useEffect(() => {
    void import("@/domain/licences").then((module) => setLicences(module.licences));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center">
      <button
        type="button"
        ref={backdropRef}
        className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
        aria-label="Close open source licences"
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label="Open source licences"
        className="relative z-10 flex max-h-[calc(100%-var(--safe-top)-1rem)] w-full flex-col rounded-t-box bg-(--sheet) p-4 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-2xl motion-safe:animate-sheet-up md:max-h-[85vh] md:w-[34rem] md:rounded-box md:pb-4 md:motion-safe:animate-dialog-in"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-base-300 md:hidden" />
        <h2 className="text-lg font-semibold">Open source licences</h2>
        <p className="mt-1 text-sm opacity-60 md:text-xs">
          The app ships these components. Each one keeps its own licence.
        </p>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {licences === null ? (
            <p className="flex items-center gap-2 py-2 text-base opacity-70 md:text-sm">
              <span className="loading loading-sm loading-spinner md:loading-xs" />
              Loading
            </p>
          ) : (
            licences.map((entry) => (
              <details key={entry.name} className="border-b border-base-300 py-2">
                <summary className="cursor-pointer text-base md:text-sm">
                  {entry.name}{" "}
                  <span className="opacity-60">
                    {entry.version === "" ? entry.licence : `${entry.version} · ${entry.licence}`}
                  </span>
                </summary>
                <pre className="mt-2 rounded-box bg-base-200 p-3 font-mono text-xs whitespace-pre-wrap">
                  {entry.text}
                </pre>
              </details>
            ))
          )}
        </div>

        <button type="button" className="btn mt-3 md:btn-sm" onClick={() => dismiss()}>
          Close
        </button>
      </aside>
    </div>
  );
}
