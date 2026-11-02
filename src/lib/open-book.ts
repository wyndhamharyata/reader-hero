import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router";

const travelMs = 470;
// The page fills the screen before the cover arrives, so the reader loads under it during the travel.
const coverMs = 260;
const swingMs = 520;
const settleMs = 220;
const fadeMs = 200;
const waitMs = 300;
const quietFrameMs = 24;
const quietCapMs = 400;
// A cover with no picture is drawn type, which holds any size. A picture grows only to its own pixels.
const maxScale = 2.2;
const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function prefersLessMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function place(element: HTMLElement, box: DOMRect): void {
  Object.assign(element.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

// The cover lifts to the middle and the page opens out behind it. Then the cover swings open, or sets down, onto the book.
export function openBook(
  navigate: NavigateFunction,
  bookId: string,
  cover: Element | null,
  isFirstOpen: boolean,
): void {
  const to = `/book/${bookId}`;

  if (cover === null || prefersLessMotion()) {
    void navigate(to);
    return;
  }

  const box = cover.getBoundingClientRect();
  const page = document.createElement("div");
  const shadow = document.createElement("div");
  const clone = cover.cloneNode(true) as HTMLElement;

  page.className = "opening-page";
  shadow.className = "zoomer-shadow";
  clone.classList.add("zoomer");
  place(page, new DOMRect(0, 0, innerWidth, innerHeight));
  place(shadow, box);
  place(clone, box);
  document.body.append(page, shadow, clone);

  // From its spine, so a swing turns on the spine. Centred, at most half the screen's height.
  const picture = cover.querySelector("img");
  const sharpScale =
    picture === null || picture.naturalWidth === 0
      ? maxScale
      : picture.naturalWidth / (box.width * devicePixelRatio);
  const scale = Math.max(1, Math.min(maxScale, sharpScale, (innerHeight * 0.55) / box.height));
  const dx = innerWidth / 2 - box.left - (box.width * scale) / 2;
  const dy = innerHeight / 2 - (box.top + box.height / 2);
  // One list of functions in every frame, so each part eases on its own and none falls back to a matrix.
  const at = (x: number, y: number, size: number, tilt: number, turn: number): string =>
    `perspective(1100px) translate(${x}px, ${y}px) scale(${size}) rotate(${tilt}deg) rotateY(${turn}deg)`;
  const lifted = at(dx, dy, scale, 0, 0);
  // Pressed down a hair first, then up before across, so it travels on an arc, and its tilt trails and swings past.
  const path: Array<Keyframe> = [
    { transform: at(0, 0, 1, 0, 0), easing: "ease-out" },
    { transform: at(0, 3, 0.97, 0, 0), offset: 0.13, easing: "ease-in-out" },
    {
      transform: at(dx * 0.4, dy * 0.78, (1 + scale) / 2, -4, 16),
      offset: 0.55,
      easing: "ease-out",
    },
    { transform: at(dx, dy, scale, 1.2, -4), offset: 0.84, easing: "ease-in-out" },
    { transform: lifted },
  ];
  // Only transform and opacity move, so the screen keeps drawing them while the reader loads. The shadow deepens as the cover rises.
  const travel = clone.animate(path, { duration: travelMs, fill: "forwards" });
  const lift = shadow.animate(
    path.map((frame, index) => ({ ...frame, opacity: index < 2 ? 0 : index / (path.length - 1) })),
    { duration: travelMs, fill: "forwards" },
  );
  const grow = page.animate(
    [
      {
        transform: `translate(${box.left}px, ${box.top}px) scale(${box.width / innerWidth}, ${box.height / innerHeight})`,
        opacity: 0,
      },
      { opacity: 1, offset: 0.35 },
      { transform: "none", opacity: 1 },
    ],
    { duration: coverMs, easing: ease, fill: "forwards" },
  );

  const reveal = (): Animation =>
    isFirstOpen
      ? clone.animate(
          [
            { transform: lifted, opacity: 1 },
            { transform: `${lifted} rotateY(-70deg)`, opacity: 1, offset: 0.6 },
            { transform: `${lifted} rotateY(-110deg)`, opacity: 0 },
          ],
          { duration: swingMs, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "forwards" },
        )
      : clone.animate(
          [
            { transform: lifted, opacity: 1 },
            { transform: `${lifted} translateY(6px) scale(0.98)`, opacity: 0 },
          ],
          { duration: settleMs, easing: "ease-in", fill: "forwards" },
        );

  // The reader mounts only once the cover is at rest, and the cover opens only once the reader stops blocking frames, so no motion stalls.
  void Promise.all([grow.finished, travel.finished, lift.finished])
    .then(() => {
      flushSync(() => void navigate(to));

      return firstPaint();
    })
    .then(quietFrames)
    .then(() => {
      // The book shows behind the cover as it opens, so the cover opens onto the page and not onto nothing.
      const fade = [{ opacity: 1 }, { opacity: 0 }];
      const fades = [page, shadow].map((element) =>
        element.animate(fade, { duration: fadeMs, fill: "forwards" }),
      );

      return Promise.all([reveal().finished, ...fades.map((animation) => animation.finished)]);
    })
    .finally(() => {
      clone.remove();
      shadow.remove();
      page.remove();
    });
}

// Two frames in a row on time, or a short cap, so the reveal never waits on a slow device for long.
function quietFrames(): Promise<void> {
  const started = performance.now();

  return new Promise((resolve) => {
    let last = started;
    let onTime = 0;
    const check = (now: number): void => {
      onTime = now - last < quietFrameMs ? onTime + 1 : 0;
      last = now;

      if (onTime >= 2 || now - started > quietCapMs) resolve();
      else requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

// The reader's first text or page, or a short wait for a book still loading.
function firstPaint(): Promise<void> {
  const started = performance.now();

  return new Promise((resolve) => {
    const check = (): void => {
      const isShown = document.querySelector("[data-block], [data-page]") !== null;

      if (isShown || performance.now() - started > waitMs) resolve();
      else requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}
