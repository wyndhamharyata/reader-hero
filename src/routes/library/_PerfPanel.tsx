import { useEffect, useMemo, useState } from "react";
import { clearEntries, snapshot, subscribe, type PerfEntry } from "@/lib/perf";

interface Props {
  onClose: () => void;
}

interface Summary {
  readonly name: string;
  readonly count: number;
  readonly total: number;
  readonly max: number;
}

function summarize(entries: ReadonlyArray<PerfEntry>): Summary[] {
  const map = new Map<string, Summary>();
  for (const entry of entries) {
    const current = map.get(entry.name);
    if (current === undefined) {
      map.set(entry.name, { name: entry.name, count: 1, total: entry.ms, max: entry.ms });
      continue;
    }
    map.set(entry.name, {
      name: entry.name,
      count: current.count + 1,
      total: current.total + entry.ms,
      max: Math.max(current.max, entry.ms),
    });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function PerfPanel({ onClose }: Props) {
  const [entries, setEntries] = useState<ReadonlyArray<PerfEntry>>(snapshot);

  useEffect(() => subscribe(() => setEntries(snapshot())), []);

  const summary = useMemo(() => summarize(entries), [entries]);
  const env = `${navigator.hardwareConcurrency ?? "?"} cores · dpr ${window.devicePixelRatio}`;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-base-100">
      <header className="flex items-center gap-2 border-b border-base-300 p-3">
        <h2 className="flex-1 text-sm font-semibold">Performance</h2>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => clearEntries()}>
          Clear
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="px-3 py-2 text-xs opacity-60">{env}</p>

      <div className="px-3 pb-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="opacity-60">
              <th className="text-left font-normal">phase</th>
              <th className="text-right font-normal">n</th>
              <th className="text-right font-normal">total</th>
              <th className="text-right font-normal">max</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.name} className="border-b border-base-200">
                <td className="truncate py-0.5">{row.name}</td>
                <td className="text-right tabular-nums">{row.count}</td>
                <td className="text-right tabular-nums">{(row.total / 1000).toFixed(1)}s</td>
                <td className="text-right tabular-nums">{row.max.toFixed(0)}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex-1 overflow-auto px-3 pb-6 font-mono text-xs">
        {entries.map((entry, index) => (
          <li key={index} className="flex justify-between gap-3 border-b border-base-200 py-1">
            <span className="truncate">
              {entry.name} {entry.detail}
            </span>
            <span className="tabular-nums">{entry.ms.toFixed(0)} ms</span>
          </li>
        ))}
        {entries.length === 0 && <li className="py-2 opacity-60">No samples yet.</li>}
      </ul>
    </div>
  );
}
