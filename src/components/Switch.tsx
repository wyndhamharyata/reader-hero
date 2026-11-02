import type { ReactElement } from "react";

export function Switch({
  isOn,
  label,
  isDisabled = false,
  onChange,
}: {
  readonly isOn: boolean;
  readonly label: string;
  readonly isDisabled?: boolean;
  readonly onChange: (isOn: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={isOn}
      aria-label={label}
      disabled={isDisabled}
      onClick={() => onChange(!isOn)}
    />
  );
}
