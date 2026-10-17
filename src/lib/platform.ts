export const isIosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent);

export const isInstalled =
  window.matchMedia("(display-mode: isStandalone)").matches ||
  (navigator as Navigator & { isStandalone?: boolean }).isStandalone === true;
