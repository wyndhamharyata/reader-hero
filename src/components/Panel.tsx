import type { ReactElement, ReactNode, Ref } from "react";
import { ArrowLeftIcon, XMarkIcon } from "@/components/icons";

// The one panel scaffold: a bottom sheet on a phone, a side panel wider up. The caller owns useBottomSheet.
export function Panel({
  sheetRef,
  backdropRef,
  label,
  title,
  onDismiss,
  onBack,
  actions,
  tabs,
  foot,
  docks = false,
  isClear = false,
  isMenu = false,
  isWide = false,
  children,
}: {
  readonly sheetRef: Ref<HTMLElement>;
  readonly backdropRef: Ref<HTMLButtonElement>;
  readonly label: string;
  // Null shows no head, as for the small More menu.
  readonly title: ReactNode | null;
  readonly onDismiss: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly actions?: ReactNode;
  readonly tabs?: ReactNode;
  readonly foot?: ReactNode;
  // Beside the page on a desktop, so the reader keeps reading while it is open.
  readonly docks?: boolean;
  // The page shows through, as for Look, where each change shows on the page at once.
  readonly isClear?: boolean;
  // A short menu: a popover under its key on a wider screen.
  readonly isMenu?: boolean;
  // A panel of lists, as the series editor, takes more of a desktop's room.
  readonly isWide?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={docks ? "panel-layer docks" : "panel-layer"}>
      <button
        ref={backdropRef}
        type="button"
        className={isClear ? "scrim clear" : "scrim"}
        aria-label="Close"
        onClick={onDismiss}
      />
      <aside
        ref={sheetRef}
        role="dialog"
        aria-label={label}
        className={isMenu ? "panel compact" : isWide ? "panel wide" : "panel"}
      >
        <div className="grab" />
        {title !== null && (
          <div className="panel-head">
            {onBack !== undefined && (
              <button type="button" className="key small square" aria-label="Back" onClick={onBack}>
                <ArrowLeftIcon className="icon" />
              </button>
            )}
            <h2>{title}</h2>
            {actions}
            <button
              type="button"
              className="key small square"
              aria-label="Close"
              onClick={onDismiss}
            >
              <XMarkIcon className="icon" />
            </button>
          </div>
        )}
        {tabs}
        <div className="panel-body">{children}</div>
        {foot !== undefined && <div className="panel-foot">{foot}</div>}
      </aside>
    </div>
  );
}
