import { useEffect, type ReactElement } from "react";
import { createPortal } from "react-dom";

// Asked over the page it concerns, so a launched file stays only if the reader says so.
export function KeepAlert({
  isOpen,
  title,
  onKeep,
  onRemove,
}: {
  readonly isOpen: boolean;
  readonly title: string;
  readonly onKeep: () => void;
  readonly onRemove: () => void;
}): ReactElement | null {
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      // Escape keeps the file, as removing it is the choice that loses it.
      onKeep();
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onKeep]);

  if (!isOpen) return null;

  return createPortal(
    <div className="panel-layer">
      <button type="button" className="scrim" aria-label="Keep" onClick={onKeep} />
      <div role="alertdialog" aria-label="Keep in library" className="ask">
        <h2 className="line-clamp-3 font-serif text-[19px] leading-tight font-bold break-words">
          Keep in library?
        </h2>
        <p className="mt-1 line-clamp-2 text-[14px] font-semibold break-words">{title}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="key green flex-1" autoFocus onClick={onKeep}>
            Keep
          </button>
          <button type="button" className="key danger-outline flex-1" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
