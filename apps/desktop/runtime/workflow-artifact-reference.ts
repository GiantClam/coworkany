export type ExternalWorkflowArtifactReference = {
  readonly artifactId?: number | string;
  readonly title?: string;
  readonly mimeType: string;
  readonly url?: string;
  readonly downloadUrl?: string;
};

/**
 * Capability-backed media can already be registered by the platform artifact
 * service. Those references do not have a localPath/relativePath, so they
 * must be carried through product_store instead of being sent to the local
 * artifact registrar a second time.
 */
export function externalWorkflowArtifactReference(value: unknown): ExternalWorkflowArtifactReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawArtifactId = record.artifactId;
  const artifactId =
    typeof rawArtifactId === "number" && Number.isFinite(rawArtifactId)
      ? rawArtifactId
      : typeof rawArtifactId === "string" && rawArtifactId.trim()
        ? rawArtifactId.trim()
        : undefined;
  const url = typeof record.url === "string" && record.url.trim() ? record.url.trim() : undefined;
  const downloadUrl = typeof record.downloadUrl === "string" && record.downloadUrl.trim() ? record.downloadUrl.trim() : undefined;
  if (artifactId === undefined && !url && !downloadUrl) return undefined;
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : typeof record.fileName === "string" && record.fileName.trim()
        ? record.fileName.trim()
        : undefined;
  const mimeType =
    typeof record.mimeType === "string" && record.mimeType.trim()
      ? record.mimeType.trim()
      : typeof record.contentType === "string" && record.contentType.trim()
        ? record.contentType.trim()
        : "application/octet-stream";
  return {
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(title ? { title } : {}),
    mimeType,
    ...(url ? { url } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
}

export function externalWorkflowArtifactKey(reference: ExternalWorkflowArtifactReference): string {
  if (reference.artifactId !== undefined) return `artifact:${String(reference.artifactId)}`;
  if (reference.downloadUrl) return `download:${reference.downloadUrl}`;
  if (reference.url) return `url:${reference.url}`;
  return `title:${reference.title ?? ""}:${reference.mimeType}`;
}

function flattenArtifactValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flattenArtifactValues) : value === undefined || value === null ? [] : [value];
}

/**
 * The desktop host receives both the canonical workflow bundle names
 * (`asset`, `image`, `video`, `audio`, `ppt`) and the port aliases used by
 * the workflow graph (`assets`, `images`, `videos`, `audios`,
 * `presentations`). Keep both forms at the persistence boundary.
 */
export function collectWorkflowArtifactValues(inputs: Record<string, unknown>): unknown[] {
  return [
    inputs.asset,
    inputs.assets,
    inputs.image,
    inputs.images,
    inputs.video,
    inputs.videos,
    inputs.audio,
    inputs.audios,
    inputs.ppt,
    inputs.presentations,
  ].flatMap(flattenArtifactValues);
}
