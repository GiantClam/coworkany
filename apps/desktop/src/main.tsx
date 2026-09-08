import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { desktopStylePlatform } from "./desktop-platform";
import "./tailwind.css";
import "@coworkany/workbench-ui/styles.css";
import "./styles.css";
import "./native-questions.css";
import "./styles-macos.css";

document.documentElement.dataset.desktopPlatform = desktopStylePlatform(navigator.userAgent, navigator.maxTouchPoints);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
