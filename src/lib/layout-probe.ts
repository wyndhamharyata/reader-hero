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

export function layoutSnapshot(): string {
  const header = document.querySelector("header");
  const headerStyle = header === null ? null : getComputedStyle(header);
  const vv = window.visualViewport;
  return JSON.stringify({
    build: "chrome-opaque-2",
    inner: `${window.innerWidth}x${window.innerHeight}`,
    client: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
    vv: vv === null ? null : `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}`,
    screen: `${window.screen.width}x${window.screen.height} avail ${window.screen.availHeight}`,
    dpr: window.devicePixelRatio,
    inset: envInsets(),
    headerRect: rect("header"),
    footerRect: rect("[data-footer]"),
    headerBackdrop: headerStyle === null ? null : headerStyle.backdropFilter,
    headerBg: headerStyle === null ? null : headerStyle.backgroundColor,
    headerTransform: headerStyle === null ? null : headerStyle.transform,
  });
}

export function probeLayout(reason: string): void {
  void log("layout.probe", `${reason} ${layoutSnapshot()}`);
}
