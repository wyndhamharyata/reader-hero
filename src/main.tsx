import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/App";
import { isInstalled } from "@/lib/platform";
import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "@/styles/app.css";
import "@/styles/text-layer.css";

// Less than this between the screen and the visible part is no keyboard.
const keyboardMinPx = 150;
const container = document.getElementById("root");
if (container === null) throw new Error("Root element is missing");

// iOS relaunches an installed app at "/", so a launch reopens the book the reader left open.
if (isInstalled && window.location.pathname === "/") {
  try {
    const screen = localStorage.getItem("last-screen");

    if (screen !== null && screen.startsWith("/book/")) {
      window.history.replaceState(null, "", screen);
    }
  } catch {
    // Without storage the launch opens the library.
  }
}

// iOS keeps a fixed sheet under the keyboard, mostly for a field focused as the sheet slides in, so sheets fit the part still showing.
const view = window.visualViewport;

if (view !== null) {
  const fit = (): void => {
    const root = document.documentElement.style;

    if (window.innerHeight - view.height < keyboardMinPx) {
      root.removeProperty("--view-top");
      root.removeProperty("--view-height");
      return;
    }

    root.setProperty("--view-top", `${view.offsetTop}px`);
    root.setProperty("--view-height", `${view.height}px`);
  };

  view.addEventListener("resize", fit);
  view.addEventListener("scroll", fit);
}

createRoot(container).render(
  <StrictMode>
    {/* Route changes apply at once, so a view transition can snapshot the new page. */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
