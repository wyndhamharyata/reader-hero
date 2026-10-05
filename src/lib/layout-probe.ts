import { log } from "@/lib/log";

function envInsets(): { top: number; bottom: number; left: number; right: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:-9999px;top:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const read = (value: string): number => Math.round(parseFloat(value) || 0);
  const insets = {
    top: read(style.paddingTop),
    bottom: read(style.paddingBottom),
    left: read(style.paddingLeft),
    right: read(style.paddingRight),
  };
  probe.remove();
  return insets;
}

function rect(selector: string): string | null {
  const element = document.querySelector(selector);
  if (element === null) return null;
  const box = element.getBoundingClientRect();
  return `${Math.round(box.top)}..${Math.round(box.bottom)} (h${Math.round(box.height)})`;
}

function measureUnit(unit: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:0;width:1px;height:100${unit};visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  const height = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return height;
}

export function layoutSnapshot(): string {
  const header = document.querySelector("header");
  const headerStyle = header === null ? null : getComputedStyle(header);
  const vv = window.visualViewport;
  const nav = navigator as Navigator & { standalone?: boolean };
  return JSON.stringify({
    build: "chrome-opaque-4",
    standalone: nav.standalone ?? null,
    ua: (navigator.userAgent.match(/OS (\d+[._]\d+)/) ?? [])[1] ?? "?",
    agent: /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
      ? "other"
      : /Safari/.test(navigator.userAgent)
        ? "safari"
        : "?",
    displayMode: window.matchMedia("(display-mode: standalone)").matches
      ? "standalone"
      : window.matchMedia("(display-mode: browser)").matches
        ? "browser"
        : "other",
    inner: `${window.innerWidth}x${window.innerHeight}`,
    client: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
    vv: vv === null ? null : `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}`,
    screen: `${window.screen.width}x${window.screen.height} avail ${window.screen.availHeight}`,
    dpr: window.devicePixelRatio,
    units: `vh${measureUnit("vh")} dvh${measureUnit("dvh")} lvh${measureUnit("lvh")} svh${measureUnit("svh")}`,
    inset: envInsets(),
    headerRect: rect("header"),
    footerRect: rect("[data-footer]"),
    headerBackdrop: headerStyle === null ? null : headerStyle.backdropFilter,
    headerBg: headerStyle === null ? null : headerStyle.backgroundColor,
    headerTransform: headerStyle === null ? null : headerStyle.transform,
    headerColor: headerStyle === null ? null : headerStyle.color,
    headerOpacity: headerStyle === null ? null : headerStyle.opacity,
    titleColor: (() => {
      const title = document.querySelector("header h1");
      return title === null ? null : getComputedStyle(title).color;
    })(),
    hitTop: (() => {
      const el = document.elementFromPoint(200, 75);
      return el === null ? null : `${el.tagName}.${el.className}`.slice(0, 60);
    })(),
    hitBottom: (() => {
      const el = document.elementFromPoint(200, Math.max(0, window.innerHeight - 5));
      return el === null ? null : `${el.tagName}.${el.className}`.slice(0, 60);
    })(),
  });
}

export function probeLayout(reason: string): void {
  let detail = "";
  try {
    detail = layoutSnapshot();
  } catch (error) {
    detail = `snapshot failed: ${String(error)}`;
  }
  void log("layout.probe", `${reason} ${detail}`);
}
