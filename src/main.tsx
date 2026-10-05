import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@/App";
import { initViewport } from "@/lib/viewport";
import "@/styles/app.css";

initViewport();

const container = document.getElementById("root");
if (container === null) throw new Error("Root element is missing");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
