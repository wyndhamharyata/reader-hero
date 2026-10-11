// A second tap within the 300ms takes over, so two loops never both scroll the list.
let frame = 0;

// Keeps the lowest visible `data-row` in place on screen while a row above it opens or closes.
export function holdLowestRow(list: HTMLElement, tapped: Element): void {
  const bottom = list.getBoundingClientRect().bottom;
  const anchor = [...list.querySelectorAll("[data-row]")].findLast(
    (row) => row.getBoundingClientRect().top < bottom,
  );
  // The lowest row itself opens downward, so its paragraph shows under it.
  if (anchor === undefined || anchor === tapped) return;
  const top = anchor.getBoundingClientRect().top;
  const start = performance.now();
  // Each frame of the 200ms animation, before the paint, so the row never jumps.
  const step = (): void => {
    // The tapped row stops at the top of the list, so a long paragraph starts in view.
    list.scrollTop += Math.min(
      anchor.getBoundingClientRect().top - top,
      tapped.getBoundingClientRect().top - list.getBoundingClientRect().top,
    );
    if (performance.now() - start < 300) frame = requestAnimationFrame(step);
  };
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(step);
}
