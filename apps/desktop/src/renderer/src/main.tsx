import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";

async function boot(): Promise<void> {
  if (import.meta.env.DEV && !window.apprentice) {
    // Preview outside Electron: install a mock bridge. Excluded from production bundles.
    const { installDevMock } = await import("./dev-mock");
    installDevMock();
  }
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root element");
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
