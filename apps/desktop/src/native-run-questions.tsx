import { useEffect, useState } from "react";
import { parseWorkbenchQuestionEvent, type WorkbenchClient, type WorkbenchQuestionClient, type WorkbenchQuestionEvent } from "@coworkany/workbench-client";
import { NativeQuestions } from "./native-questions";

/** Workflow nodes create their own OpenCode sessions, discoverable from run events. */
export function NativeRunQuestions({ client, runId, locale }: {
  client: WorkbenchClient & { questions: WorkbenchQuestionClient };
  runId: string;
  locale: "zh" | "en";
}) {
  const [sessions, setSessions] = useState<string[]>([]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const receive = (event: WorkbenchQuestionEvent) => {
      if (disposed || event.runId !== runId) return;
      setSessions((current) => current.includes(event.sessionId) ? current : [...current, event.sessionId]);
    };
    void (async () => {
      unlisten = await client.questions.subscribe(null, receive);
      if (disposed) { unlisten(); return; }
      const detail = await client.runs.inspect(runId);
      for (const row of detail.events) {
        try {
          const event = parseWorkbenchQuestionEvent(JSON.parse(row.payloadJson));
          if (event) receive(event);
        } catch { /* malformed historical frames cannot create a question */ }
      }
    })().catch(() => {
      // A run may have no persisted question events (for example, an older
      // run that has already completed). That is an empty recovery result,
      // not content that belongs at the bottom of the workflow canvas.
      if (!disposed) setSessions([]);
    });
    return () => { disposed = true; unlisten?.(); };
  }, [client, runId]);
  return <div className="native-question-stack">
    {sessions.map((sessionId) => <NativeQuestions key={sessionId} client={client.questions} sessionId={sessionId} runId={runId} locale={locale} />)}
  </div>;
}
