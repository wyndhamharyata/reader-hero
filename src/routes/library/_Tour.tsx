import { useEffect, useLayoutEffect, useState, type ReactElement } from "react";
import { dockAt, type Box, type TourStep } from "@/lib/tour";

interface Props {
  steps: ReadonlyArray<TourStep>;
  onDone: () => void;
}

// One dim layer with a hole over the target, and a card that keeps clear of it.
export function Tour({ steps, onDone }: Props): ReactElement | null {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const step = steps[index];
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useLayoutEffect(() => {
    const measure = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const key = step?.anchor ?? null;
      if (key === null) {
        setSpot(null);
        return;
      }
      // Two controls can carry a key, the one for a phone and the one for a wider window.
      const found = [...document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)].find(
        (element) => element.getBoundingClientRect().width > 0,
      );
      if (found === undefined) {
        setSpot(null);
        return;
      }
      const rect = found.getBoundingClientRect();
      setSpot({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    // Capture, so the library's own scroll box reports as well as the window.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
      if (event.key === "ArrowRight") setIndex((at) => Math.min(at + 1, steps.length - 1));
      if (event.key === "ArrowLeft") setIndex((at) => Math.max(at - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone, steps.length]);

  if (step === undefined) return null;

  const edge = 6;
  const hole =
    spot === null
      ? null
      : {
          top: Math.max(0, spot.top - edge),
          left: Math.max(0, spot.left - edge),
          right: Math.min(viewport.width, spot.left + spot.width + edge),
          bottom: Math.min(viewport.height, spot.top + spot.height + edge),
        };
  const dock = dockAt(spot, viewport.height);
  const last = index === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-60"
      role="dialog"
      aria-modal="true"
      aria-label="How Reader Hero works"
    >
      {hole === null ? (
        <div className="pointer-events-none absolute inset-0 bg-black/55 motion-safe:animate-fade-in" />
      ) : (
        <div className="pointer-events-none absolute inset-0 motion-safe:animate-fade-in">
          <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: hole.top }} />
          <div className="absolute inset-x-0 bg-black/55" style={{ top: hole.bottom, bottom: 0 }} />
          <div
            className="absolute bg-black/55"
            style={{ top: hole.top, height: hole.bottom - hole.top, width: hole.left }}
          />
          <div
            className="absolute bg-black/55"
            style={{
              top: hole.top,
              left: hole.right,
              right: 0,
              height: hole.bottom - hole.top,
            }}
          />
          <div
            className="absolute rounded-2xl ring-2 ring-primary transition-all duration-300 ease-out motion-reduce:transition-none"
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.right - hole.left,
              height: hole.bottom - hole.top,
            }}
          />
        </div>
      )}

      {/* The shield swallows every tap, so the tour cannot change what it explains. */}
      <div className="absolute inset-0" aria-hidden="true" />

      <div
        className={
          dock === "center"
            ? "absolute inset-0 flex items-center justify-center p-4"
            : dock === "bottom"
              ? "absolute inset-x-0 bottom-0 flex justify-center p-4 pb-[calc(var(--safe-bottom)+1rem)]"
              : "absolute inset-x-0 top-0 flex justify-center p-4 pt-[calc(var(--safe-top)+1rem)]"
        }
      >
        <div
          key={index}
          className="pointer-events-auto w-full max-w-sm rounded-box bg-base-100 p-4 shadow-2xl motion-safe:animate-dialog-in"
        >
          <p className="text-lg font-semibold">{step.title}</p>
          <p className="mt-1 text-base opacity-80 md:text-sm">{step.body}</p>
          <div className="mt-3 flex justify-center gap-1.5">
            {steps.map((entry, at) => (
              <span
                key={entry.title}
                className={`size-1.5 rounded-full ${at === index ? "bg-primary" : "bg-base-300"}`}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className="btn btn-ghost md:btn-sm" onClick={onDone}>
              Skip
            </button>
            <span className="flex gap-2">
              {index > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost md:btn-sm"
                  onClick={() => setIndex((at) => at - 1)}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary md:btn-sm"
                onClick={() => (last ? onDone() : setIndex((at) => at + 1))}
              >
                {last ? "Done" : "Next"}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
