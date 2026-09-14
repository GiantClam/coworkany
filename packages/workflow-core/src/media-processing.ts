export const VIDEO_PROCESS_OPERATIONS = ["stitch", "transform", "overlay", "subtitle", "mux"] as const;
export const AUDIO_PROCESS_OPERATIONS = ["trim", "mix", "normalize"] as const;

export type VideoProcessOperation = (typeof VIDEO_PROCESS_OPERATIONS)[number];
export type AudioProcessOperation = (typeof AUDIO_PROCESS_OPERATIONS)[number];
export type WorkflowProcessNodeType = "video_process" | "audio_process";
export type WorkflowProcessOperation = VideoProcessOperation | AudioProcessOperation;

export type WorkflowProcessPortPolicy = {
  readonly allowed: readonly string[];
  readonly min?: Readonly<Record<string, number>>;
  readonly max?: Readonly<Record<string, number>>;
};

const VIDEO_POLICIES: Record<VideoProcessOperation, WorkflowProcessPortPolicy> = {
  stitch: { allowed: ["videos"], min: { videos: 2 } },
  transform: { allowed: ["videos"], min: { videos: 1 }, max: { videos: 1 } },
  overlay: { allowed: ["videos", "images"], min: { videos: 1, images: 1 }, max: { videos: 1 } },
  subtitle: { allowed: ["videos", "text"], min: { videos: 1, text: 1 }, max: { videos: 1 } },
  mux: { allowed: ["videos", "audios"], min: { videos: 1, audios: 1 }, max: { videos: 1 } },
};

const AUDIO_POLICIES: Record<AudioProcessOperation, WorkflowProcessPortPolicy> = {
  trim: { allowed: ["audios"], min: { audios: 1 }, max: { audios: 1 } },
  mix: { allowed: ["audios"], min: { audios: 1 } },
  normalize: { allowed: ["audios"], min: { audios: 1 }, max: { audios: 1 } },
};

export function getWorkflowProcessOperation(nodeType: WorkflowProcessNodeType, config: Record<string, unknown>): WorkflowProcessOperation {
  const operation = typeof config.operation === "string" ? config.operation : "";
  if (nodeType === "video_process" && (VIDEO_PROCESS_OPERATIONS as readonly string[]).includes(operation)) return operation as VideoProcessOperation;
  if (nodeType === "audio_process" && (AUDIO_PROCESS_OPERATIONS as readonly string[]).includes(operation)) return operation as AudioProcessOperation;
  return nodeType === "video_process" ? "stitch" : "trim";
}

export function getWorkflowProcessPortPolicy(nodeType: WorkflowProcessNodeType, operation: WorkflowProcessOperation): WorkflowProcessPortPolicy {
  if (nodeType === "video_process" && operation in VIDEO_POLICIES) return VIDEO_POLICIES[operation as VideoProcessOperation];
  if (nodeType === "audio_process" && operation in AUDIO_POLICIES) return AUDIO_POLICIES[operation as AudioProcessOperation];
  return nodeType === "video_process" ? VIDEO_POLICIES.stitch : AUDIO_POLICIES.trim;
}

export function isWorkflowProcessPortAllowed(nodeType: WorkflowProcessNodeType, config: Record<string, unknown>, portId: string) {
  return getWorkflowProcessPortPolicy(nodeType, getWorkflowProcessOperation(nodeType, config)).allowed.includes(portId);
}

export function validateWorkflowProcessInputs(nodeType: WorkflowProcessNodeType, config: Record<string, unknown>, counts: Readonly<Record<string, number>>): string[] {
  const operation = getWorkflowProcessOperation(nodeType, config);
  const policy = getWorkflowProcessPortPolicy(nodeType, operation);
  const issues: string[] = [];
  for (const [portId, count] of Object.entries(counts)) {
    if (count > 0 && !policy.allowed.includes(portId)) issues.push(`${nodeType}.${operation} does not accept ${portId} inputs`);
  }
  for (const [portId, minimum] of Object.entries(policy.min ?? {})) {
    if ((counts[portId] ?? 0) < minimum) {
      const noun = portId === "text" ? "subtitle text" : portId === "audios" ? "audio" : portId === "videos" ? "video" : portId.replace(/s$/, "");
      issues.push(`${nodeType}.${operation} requires ${minimum === 1 ? (noun === "audio" ? "an" : "a") : `at least ${minimum}`} ${noun} input${minimum === 1 ? "" : "s"}`);
    }
  }
  for (const [portId, maximum] of Object.entries(policy.max ?? {})) {
    if ((counts[portId] ?? 0) > maximum) issues.push(`${nodeType}.${operation} accepts at most ${maximum} ${portId === "audios" ? "audio" : portId === "videos" ? "video" : portId} input${maximum === 1 ? "" : "s"}`);
  }
  return issues;
}
