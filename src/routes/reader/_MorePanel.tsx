import { useRef, type ReactElement } from "react";
import { Panel } from "@/components/Panel";
import type { ReaderMode } from "@/domain/book";
import { useBottomSheet } from "@/lib/use-bottom-sheet";

export function MorePanel({
  mode,
  isEpub,
  onToggleMode,
  onDetails,
  onClose,
}: {
  readonly mode: ReaderMode;
  // An EPUB has no pages to show, so it has no other view.
  readonly isEpub: boolean;
  readonly onToggleMode: () => void;
  readonly onDetails: () => void;
  readonly onClose: () => void;
}): ReactElement {
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const { dismiss } = useBottomSheet(true, sheetRef, backdropRef, onClose);

  return (
    <Panel
      sheetRef={sheetRef}
      backdropRef={backdropRef}
      label="More"
      title={null}
      isMenu
      isClear
      onDismiss={() => dismiss()}
    >
      <div className="rows mt-3 md:mt-0">
        {!isEpub && (
          <button
            type="button"
            className="row-item"
            // The view changes at once, under the menu as it closes.
            onClick={() => {
              onToggleMode();
              dismiss();
            }}
          >
            <span className="row-label">{mode === "reader" ? "Original view" : "Reader view"}</span>
          </button>
        )}
        <button type="button" className="row-item" onClick={() => dismiss(onDetails)}>
          <span className="row-label">Book details</span>
          <span className="chev" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </Panel>
  );
}
