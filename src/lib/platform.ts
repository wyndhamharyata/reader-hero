export const isIosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent);

export const isInstalled =
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
