import { copyFile, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DesktopPaths } from "./paths";
import { usableRunningHubWorkflowId, type DesktopProviderConfig, type DesktopProviderDefaults, type DesktopProviderProfiles, type ProviderCapability } from "../src/provider-config";
import { migrateLegacyRunningHubWorkflows, normalizeRunningHubCharacterImageBindings, type RunningHubWorkflowRegistration } from "../src/runninghub-workflow";

export interface DesktopConfig {
  readonly schemaVersion: 1;
  readonly locale?: "auto" | "zh" | "en";
  readonly workspacePath: string;
  readonly obsidianVaultPath?: string;
  readonly obsidianIndexPath?: string;
  readonly embedding?: DesktopEmbeddingConfig;
  readonly offlineRuntimeZipPath?: string;
  /** Agent IDs explicitly added from the local Agent Center to the sidebar. */
  readonly menuAgentIds?: string[];
  readonly provider: DesktopProviderConfig & { readonly model: string };
  readonly providers?: DesktopProviderProfiles;
  readonly defaults?: DesktopProviderDefaults;
  readonly runtime: { readonly source: "system" | "private"; readonly nodePath?: string; readonly opencodePath?: string; readonly pythonPath?: string; readonly hostPath?: string; readonly knowledgePath?: string; readonly skillsPath?: string; readonly fontsPath?: string; readonly lancedbPath?: string; readonly embeddingPath?: string };
}

export interface DesktopEmbeddingConfig {
  readonly mode: "local" | "remote";
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
}

export function defaultDesktopConfig(paths: DesktopPaths): DesktopConfig {
  return { schemaVersion: 1, locale: "auto", workspacePath: paths.projects, provider: { id: "local", source: "local", model: "", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "" }, runtime: { source: "system" } };
}

export async function readDesktopConfig(paths: DesktopPaths): Promise<DesktopConfig> {
  try { return parseConfig(await readFile(paths.configFile, "utf8")); }
  catch { try { return parseConfig(await readFile(join(paths.root, "config.backup.json"), "utf8")); } catch { return defaultDesktopConfig(paths); } }
}

export async function writeDesktopConfig(paths: DesktopPaths, config: DesktopConfig) {
  const normalized = parseConfig(JSON.stringify(config));
  await mkdir(dirname(paths.configFile), { recursive: true });
  const tmp = `${paths.configFile}.tmp`;
  const handle = await open(tmp, "w");
  try { await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await copyFile(paths.configFile, join(paths.root, "config.backup.json")); } catch { /* first write */ }
  await rename(tmp, paths.configFile);
}

function parseConfig(raw: string): DesktopConfig {
  const value = JSON.parse(raw) as Partial<DesktopConfig>;
  if (value.schemaVersion !== 1 || typeof value.workspacePath !== "string" || !value.provider || !value.runtime) throw new Error("invalid desktop config");
  const models = normalizeConfiguredModels(value.provider.models);
  const requestedModel = String(value.provider.model ?? "").trim();
  const model = models.includes(requestedModel) ? requestedModel : (models[0] ?? requestedModel);
  const capabilities = normalizeProviderCapabilities(value.provider.capabilities);
  const embedding = normalizeEmbeddingConfig(value.embedding);
  const providerWorkflows = normalizeAndMigrateRunningHubWorkflows(value.provider.workflows, legacyWorkflowIds(value.provider));
  return {
    schemaVersion: 1,
    locale: value.locale === "zh" || value.locale === "en" ? value.locale : "auto",
    workspacePath: value.workspacePath,
    ...(typeof value.obsidianVaultPath === "string" ? { obsidianVaultPath: value.obsidianVaultPath } : {}),
    ...(typeof value.obsidianIndexPath === "string" ? { obsidianIndexPath: value.obsidianIndexPath } : {}),
    ...(embedding ? { embedding } : {}),
    ...(typeof (value as Partial<DesktopConfig>).offlineRuntimeZipPath === "string" ? { offlineRuntimeZipPath: (value as Partial<DesktopConfig>).offlineRuntimeZipPath } : {}),
    ...(normalizeMenuAgentIds(value.menuAgentIds).length ? { menuAgentIds: normalizeMenuAgentIds(value.menuAgentIds) } : {}),
    provider: { id: String(value.provider.id ?? "local"), model, ...(models.length ? { models } : {}), ...(capabilities ? { capabilities } : {}), ...(value.provider.source ? { source: String(value.provider.source) } : {}), ...(value.provider.baseUrl ? { baseUrl: String(value.provider.baseUrl) } : {}), ...(value.provider.apiKey ? { apiKey: String(value.provider.apiKey) } : {}), ...(value.provider.reasoningEffort ? { reasoningEffort: String(value.provider.reasoningEffort) } : {}), ...(typeof value.provider.skillId === "string" && value.provider.skillId.trim() ? { skillId: value.provider.skillId.trim() } : {}), ...(value.provider.endpoint ? { endpoint: String(value.provider.endpoint) } : {}), ...(value.provider.queryEndpoint ? { queryEndpoint: String(value.provider.queryEndpoint) } : {}), ...(providerWorkflows ? { workflows: providerWorkflows } : {}) },
    ...(normalizeProviderProfiles(value.providers) ? { providers: normalizeProviderProfiles(value.providers) } : {}),
    ...(normalizeProviderDefaults(value.defaults) ? { defaults: normalizeProviderDefaults(value.defaults) } : {}),
    runtime: {
      source: value.runtime.source === "private" ? "private" : "system",
      ...(value.runtime.nodePath ? { nodePath: String(value.runtime.nodePath) } : {}),
      ...(value.runtime.opencodePath ? { opencodePath: String(value.runtime.opencodePath) } : {}),
      ...(value.runtime.pythonPath ? { pythonPath: String(value.runtime.pythonPath) } : {}),
      ...(value.runtime.hostPath ? { hostPath: String(value.runtime.hostPath) } : {}),
      ...(value.runtime.knowledgePath ? { knowledgePath: String(value.runtime.knowledgePath) } : {}),
      ...(value.runtime.skillsPath ? { skillsPath: String(value.runtime.skillsPath) } : {}),
      ...(value.runtime.fontsPath ? { fontsPath: String(value.runtime.fontsPath) } : {}),
      ...(value.runtime.lancedbPath ? { lancedbPath: String(value.runtime.lancedbPath) } : {}),
      ...(value.runtime.embeddingPath ? { embeddingPath: String(value.runtime.embeddingPath) } : {}),
    },
  };
}

function normalizeMenuAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))].slice(0, 64);
}

function normalizeProviderProfiles(value: unknown): DesktopProviderProfiles | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const profiles: Record<string, DesktopProviderConfig> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : key.trim();
    if (!id) continue;
    const models = normalizeConfiguredModels(record.models);
    const capabilities = normalizeProviderCapabilities(record.capabilities);
    const workflows = normalizeAndMigrateRunningHubWorkflows(record.workflows, legacyWorkflowIds(record));
    profiles[key] = {
      id,
      ...(typeof record.source === "string" && record.source.trim() ? { source: record.source.trim() } : {}),
      ...(typeof record.model === "string" ? { model: models.includes(record.model.trim()) ? record.model.trim() : (models[0] ?? record.model.trim()) } : models.length ? { model: models[0] } : {}),
      ...(models.length ? { models } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(typeof record.baseUrl === "string" && record.baseUrl.trim() ? { baseUrl: record.baseUrl.trim() } : {}),
      ...(typeof record.apiKey === "string" && record.apiKey ? { apiKey: record.apiKey } : {}),
      ...(typeof record.reasoningEffort === "string" && record.reasoningEffort.trim() ? { reasoningEffort: record.reasoningEffort.trim() } : {}),
      ...(typeof record.skillId === "string" && record.skillId.trim() ? { skillId: record.skillId.trim() } : {}),
      ...(typeof record.endpoint === "string" && record.endpoint.trim() ? { endpoint: record.endpoint.trim() } : {}),
      ...(typeof record.queryEndpoint === "string" && record.queryEndpoint.trim() ? { queryEndpoint: record.queryEndpoint.trim() } : {}),
      ...(workflows ? { workflows } : {}),
    };
  }
  return Object.keys(profiles).length ? profiles : undefined;
}

function normalizeAndMigrateRunningHubWorkflows(value: unknown, legacy: ReturnType<typeof legacyWorkflowIds>): readonly RunningHubWorkflowRegistration[] | undefined {
  const migrated = migrateLegacyRunningHubWorkflows(normalizeRunningHubWorkflows(value), legacy);
  return migrated?.map(normalizeRunningHubCharacterImageBindings);
}

function normalizeRunningHubWorkflows(value: unknown): readonly RunningHubWorkflowRegistration[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const workflows = value.filter((item): item is RunningHubWorkflowRegistration => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string" && typeof (item as Record<string, unknown>).remoteWorkflowId === "string" && Array.isArray((item as Record<string, unknown>).inputSchema) && Array.isArray((item as Record<string, unknown>).nodeBindings))).slice(0, 128);
  return workflows.length ? workflows : undefined;
}

function legacyWorkflowIds(value: Record<string, unknown>) {
  return {
    ...(usableRunningHubWorkflowId(value.workflowId) ? { workflowId: usableRunningHubWorkflowId(value.workflowId) } : {}),
    ...(usableRunningHubWorkflowId(value.workflowId) ? { workflowId: usableRunningHubWorkflowId(value.workflowId) } : {}),
    ...(usableRunningHubWorkflowId(value.digitalHumanWorkflowId) ? { digitalHumanWorkflowId: usableRunningHubWorkflowId(value.digitalHumanWorkflowId) } : {}),
    ...(usableRunningHubWorkflowId(value.videoEnhanceWorkflowId) ? { videoEnhanceWorkflowId: usableRunningHubWorkflowId(value.videoEnhanceWorkflowId) } : {}),
  };
}

function normalizeProviderDefaults(value: unknown): DesktopProviderDefaults | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const defaults: DesktopProviderDefaults = {};
  for (const capability of ["text", "image", "video", "audio"] as const) {
    const selected = (value as Record<string, unknown>)[capability];
    if (typeof selected === "string" && selected.trim()) defaults[capability] = selected.trim();
  }
  return Object.keys(defaults).length ? defaults : undefined;
}

function normalizeConfiguredModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean))];
}

function normalizeProviderCapabilities(value: unknown): ProviderCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<ProviderCapability>(["text", "image", "video", "audio"]);
  const normalized = value
    .filter((capability): capability is string => typeof capability === "string")
    .map((capability) => capability.trim().toLowerCase())
    .filter((capability): capability is ProviderCapability => allowed.has(capability as ProviderCapability));
  const capabilities = [...new Set(normalized)];
  return capabilities.length ? capabilities : undefined;
}

function normalizeEmbeddingConfig(value: unknown): DesktopEmbeddingConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    mode: record.mode === "remote" ? "remote" : "local",
    ...(typeof record.baseUrl === "string" && record.baseUrl.trim() ? { baseUrl: record.baseUrl.trim() } : {}),
    ...(typeof record.model === "string" && record.model.trim() ? { model: record.model.trim() } : {}),
    ...(typeof record.apiKey === "string" && record.apiKey ? { apiKey: record.apiKey } : {}),
  };
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [/(key|token|secret|password)/iu.test(key) ? key : key, /(key|token|secret|password)/iu.test(key) ? "[REDACTED]" : redactSecrets(item)]));
}
