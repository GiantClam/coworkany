import React from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchMessageSurface } from "@coworkany/workbench-ui/desktop";
import { AcceptanceHarness } from "./assistant-turn-fixture";
import "../src/tailwind.css";
import "@coworkany/workbench-ui/styles.css";
import "../src/styles.css";
import "../src/native-questions.css";
import "../src/styles-macos.css";
import "./assistant-turn-fixture.css";

const restoreScrollTop = new URLSearchParams(window.location.search).get("scenario") === "restore" ? 420 : undefined;

createRoot(document.getElementById("root")!).render(<AcceptanceHarness view="desktop">{(messages, pendingMessageId) =>
  <WorkbenchMessageSurface messages={messages} pendingMessageId={pendingMessageId} locale="en" restoreScrollTop={restoreScrollTop} scrollStateKey="fixture" onCopy={() => undefined} onRetry={() => undefined} onToolApproval={() => undefined} onArtifactOpen={() => undefined} />
}</AcceptanceHarness>);
