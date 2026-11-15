import type {
  WorkflowArtifactPort,
  WorkflowCapabilityPort,
  WorkflowDefinitionEnvelope,
  WorkflowRunEventSink,
  WorkflowRunRepository,
} from "@coworkany/workflow-core";
import type { OpenCodeRuntimeEvent } from "@coworkany/runtime-contracts/opencode";

export type DesktopWorkflowPortEvent = Extract<OpenCodeRuntimeEvent, { event: "tool_event" }>;

export interface DesktopWorkflowPortDependencies {
  readonly runId: string;
  readonly workspacePath: string;
  readonly emit: (event: OpenCodeRuntimeEvent) => void;
  readonly capability: WorkflowCapabilityPort;
  readonly requestService: (method: "workflow.repository.create" | "workflow.repository.update_status" | "workflow.artifact.register" | "workflow.event.append", payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface DesktopWorkflowPorts {
  readonly capability: WorkflowCapabilityPort;
  readonly repository: WorkflowRunRepository;
  readonly artifacts: WorkflowArtifactPort;
  readonly events: WorkflowRunEventSink;
}

const MAX_EVENT_BYTES = 64 * 1024;

/**
 * Bridges the shared workflow-core ports to the desktop host RPC stream.
 * Persistence remains owned by the Tauri side, which consumes the bounded
 * events and writes SQLite records with its existing idempotency rules.
 */
export function createDesktopWorkflowPorts(dependencies: DesktopWorkflowPortDependencies): DesktopWorkflowPorts {
  const emitTool = (tool: string, message: Record<string, unknown>, phase: "started" | "completed" | "progress") => {
    const serialized = JSON.stringify(message);
    dependencies.emit({
      event: "tool_event",
      tool,
      phase,
      message: serialized.length <= MAX_EVENT_BYTES ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, MAX_EVENT_BYTES - 64) }),
      runId: dependencies.runId,
    });
  };

  const repository: WorkflowRunRepository = {
    async create(input: { readonly runId: string; readonly definition: WorkflowDefinitionEnvelope }) {
      await dependencies.requestService("workflow.repository.create", { runId: input.runId, definition: input.definition });
      emitTool("workflow:run_created", { runId: input.runId, definitionHash: input.definition.definitionHash }, "started");
    },
    async updateStatus(runId, status) {
      await dependencies.requestService("workflow.repository.update_status", { runId, status });
      emitTool("workflow:run_status", { runId, status }, "completed");
    },
  };

  const artifacts: WorkflowArtifactPort = {
    async register(input) {
      const result = await dependencies.requestService("workflow.artifact.register", { runId: dependencies.runId, workspacePath: dependencies.workspacePath, ...input });
      const artifactId = typeof result.artifactId === "string" ? result.artifactId : `${dependencies.runId}:${input.relativePath}`;
      emitTool("workflow:artifact_registered", { artifactId, ...input }, "completed");
      return { artifactId };
    },
  };

  const events: WorkflowRunEventSink = {
    async append(event) {
      await dependencies.requestService("workflow.event.append", { runId: event.runId, sequence: event.sequence, type: event.type, payload: event.payload });
      const phase = event.type === "node_started" ? "started" : event.type === "node_failed" ? "failed" : "completed";
      const payload = { sequence: event.sequence, ...event.payload };
      const serialized = JSON.stringify(payload);
      dependencies.emit({
        event: "tool_event",
        tool: `workflow:${event.type}`,
        phase,
        message: serialized.length <= MAX_EVENT_BYTES ? serialized : JSON.stringify({ truncated: true, preview: serialized.slice(0, MAX_EVENT_BYTES - 64) }),
        runId: dependencies.runId,
      });
    },
  };

  return { capability: dependencies.capability, repository, artifacts, events };
}
