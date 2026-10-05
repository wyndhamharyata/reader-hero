import { runApp } from "@/lib/hooks";
import { log } from "@/lib/log";
import { isInstalled, isIosBrowser } from "@/lib/platform";

let started = false;

/** Measures a viewport unit (dvh, svh, lvh) with a throwaway element. */
function unitHeight(unit: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:-9999px;width:1px;height:100${unit};pointer-events:none;`;
  document.body.appendChild(probe);
  const height = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return height;
}

function envInset(side: "top" | "bottom"): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:-9999px;width:1px;height:1px;padding-${side}:env(safe-area-inset-${side},0px);`;
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).getPropertyValue(`padding-${side}`);
  probe.remove();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function metrics(): string {
  return [
    `inner:${window.innerHeight}`,
    `vv:${Math.round(window.visualViewport?.height ?? 0)}`,
    `client:${document.documentElement.clientHeight}`,
    `dvh:${unitHeight("dvh")}`,
    `safe:${envInset("top")}/${envInset("bottom")}`,
  ].join(" ");
}

/**
 * iOS standalone still exposes a dynamic viewport as if a browser toolbar could
 * hide: the reported height grows once the page scrolls. The app must not
 * relayout mid-scroll, so in installed mode measure once and freeze the value
 * in a CSS var. A width change (rotation) is a real viewport change and
 * re-measures; height-only changes are ignored. Browser mode keeps the live
 * 100dvh default from app.css.
 */
export function initViewport(): void {
  if (started) return;
  started = true;
  if (!isInstalled) return;

  const root = document.documentElement;
  if (isIosBrowser) {
    // The frozen viewport already ends above the phantom toolbar strip, so the
    // home-indicator inset would offset the UI a second time.
    root.style.setProperty("--safe-bottom", "0px");
  }
  const freeze = (reason: string): void => {
    const inner = window.innerHeight;
    const dvh = unitHeight("dvh");
    const height = dvh > 0 ? Math.min(inner, dvh) : inner;
    root.style.setProperty("--app-height", `${height}px`);
    const bottom = getComputedStyle(root).getPropertyValue("--safe-bottom").trim();
    void runApp(log("viewport.freeze", `${reason} use:${height} ui-bottom:${bottom} ${metrics()}`));
  };

  freeze("init");

  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  let drifts = 0;
  window.addEventListener("resize", () => {
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      lastHeight = window.innerHeight;
      freeze("rotate");
      return;
    }
    if (window.innerHeight !== lastHeight && drifts < 6) {
      lastHeight = window.innerHeight;
      drifts += 1;
      void runApp(log("viewport.drift", metrics()));
    }
  });
}
