import { useRef, useState, type ReactElement } from "react";
import { Logo } from "@/components/Logo";
import { PerfPanel } from "./_PerfPanel";

// Five taps on the title open the on-device performance panel, a debug view with no other entry.
export function LibraryTitle(): ReactElement {
  const taps = useRef(0);
  const [perfOpen, setPerfOpen] = useState(false);

  const onTap = () => {
    taps.current += 1;
    if (taps.current < 5) return;
    taps.current = 0;
    setPerfOpen(true);
  };

  return (
    <>
      <h1>
        <button type="button" className="block cursor-default" onClick={onTap}>
          <Logo className="h-7 w-auto md:h-8" />
        </button>
      </h1>
      {perfOpen && <PerfPanel onClose={() => setPerfOpen(false)} />}
    </>
  );
}
