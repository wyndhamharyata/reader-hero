import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/App";
import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "@/styles/app.css";

// The library keeps and puts back its own scroll; the browser's restore on Back put it elsewhere.
history.scrollRestoration = "manual";

const container = document.getElementById("root");
if (container === null) throw new Error("Root element is missing");

createRoot(container).render(
  <StrictMode>
    {/* Route changes apply at once, so a view transition can snapshot the new page. */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
