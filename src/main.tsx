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

createRoot(container).render(
  <StrictMode>
    {/* Route changes apply at once, so a view transition can snapshot the new page. */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
