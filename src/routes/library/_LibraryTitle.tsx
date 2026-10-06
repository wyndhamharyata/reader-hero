import { useRef, useState, type ReactElement } from "react";
import { offlineBadge } from "@/lib/badges";
import { PerfPanel } from "./_PerfPanel";

export function OfflineBadge(): ReactElement {
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
      <button type="button" className={offlineBadge} onClick={onTap}>
        offline
      </button>
      {perfOpen && <PerfPanel onClose={() => setPerfOpen(false)} />}
    </>
  );
}
