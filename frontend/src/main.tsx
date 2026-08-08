import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { NotificationsProvider } from "./components/Notifications";

// Global stylesheets, imported once here. tokens.css must come first —
// everything else reads its custom properties.
import "./styles/tokens.css";
import "./styles/base.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

createRoot(container).render(
  <StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </StrictMode>,
);
