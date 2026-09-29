const ARTIFACT_REQUEST = /(?:生成|创建|导出|保存|写入|输出).{0,80}(?:文件|文档|备忘录|报告|表格|合同|草稿|markdown|md|docx|xlsx|pptx|artifact|file|document|memo|report)|(?:create|generate|export|save|write).{0,100}(?:file|document|memo|brief|report|contract|markdown|\.md\b|\.docx\b|\.xlsx\b|\.pptx\b|artifact)/iu;

export function promptRequestsArtifact(prompt: string) {
  return ARTIFACT_REQUEST.test(prompt.trim());
}

export function chatAllowsArtifactRegistration(prompt: string, context: {
  readonly actionId?: string;
  readonly skillId?: string;
  readonly agentId?: string;
  readonly route?: string;
} = {}) {
  if (promptRequestsArtifact(prompt)) return true;
  const actionId = context.actionId?.trim().toLowerCase();
  const skillId = context.skillId?.trim().toLowerCase();
  const agentId = context.agentId?.trim().toLowerCase();
  const route = context.route?.trim().toLowerCase() ?? "";
  return actionId === "ppt_generate"
    || skillId === "ppt-master"
    || skillId === "dashi-ppt"
    || agentId === "executive-ppt"
    || agentId === "executive-presentation-ppt"
    || route.includes("executive-ppt")
    || route.includes("executive-presentation-ppt");
}
