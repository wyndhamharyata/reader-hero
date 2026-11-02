import { useEffect, useRef, useState, type ReactElement } from "react";
import { Panel } from "@/components/Panel";
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
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="Open source licences"
      title="Open source licences"
      onDismiss={() => dismiss()}
    >
      {licences === null ? (
        <p className="text-(--ink-soft)">Loading</p>
      ) : (
        <div className="rows">
          {licences.map((entry) => (
            <details key={entry.name} className="row-item block">
              <summary className="flex cursor-pointer items-center gap-3">
                <span className="row-label">{entry.name}</span>
                <span className="value">
                  {entry.version === "" ? entry.licence : `${entry.version} · ${entry.licence}`}
                </span>
              </summary>
              <pre className="mt-2 rounded-xl bg-(--sunk) p-3 font-mono text-xs whitespace-pre-wrap">
                {entry.text}
              </pre>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}
