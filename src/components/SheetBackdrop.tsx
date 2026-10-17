import type { ReactElement, Ref } from "react";

export function SheetBackdrop({
  reference,
  label,
  onClose,
}: {
  readonly reference: Ref<HTMLButtonElement>;
  readonly label: string;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      ref={reference}
      className="absolute inset-0 bg-(--backdrop) motion-safe:animate-fade-in"
      aria-label={label}
      onClick={onClose}
    />
  );
}
