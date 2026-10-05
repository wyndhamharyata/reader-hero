import { useEffect, useRef, useState } from "react";
import { AdjustmentsIcon, Bars3Icon, BookOpenIcon, ListBulletIcon } from "./_icons";

interface Props {
  modeLabel: string;
  onContents: () => void;
  onToggleMode: () => void;
  onSettings: () => void;
}

export function HeaderMenu({ modeLabel, onContents, onToggleMode, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const menu = ref.current;
      if (menu !== null && event.target instanceof Node && !menu.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square"
        aria-label="Menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Bars3Icon />
      </button>
      {open && (
        <ul className="menu absolute right-0 z-50 mt-1 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          <li>
            <button type="button" onClick={run(onContents)}>
              <ListBulletIcon className="size-4" />
              Contents
            </button>
          </li>
          <li>
            <button type="button" onClick={run(onToggleMode)}>
              <BookOpenIcon className="size-4" />
              {modeLabel}
            </button>
          </li>
          <li>
            <button type="button" onClick={run(onSettings)}>
              <AdjustmentsIcon className="size-4" />
              Text settings
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
