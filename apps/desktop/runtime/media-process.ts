import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { getWorkflowProcessOperation, type WorkflowProcessNodeType } from "@coworkany/workflow-core";

type MediaProcessOptions = {
  readonly nodeType: WorkflowProcessNodeType;
  readonly config: Record<string, unknown>;
  readonly inputs: Record<string, unknown>;
  readonly workspacePath: string;
  readonly runId: string;
  readonly nodeKey: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number, message: string) => void;
};

type Probe = { readonly duration: number; readonly hasAudio: boolean; readonly hasVideo: boolean };
type ProcessResult = { readonly localPath: string; readonly relativePath: string; readonly mimeType: string; readonly byteLength: number; readonly sha256: string };

async function resultFor(outputPath: string, workspacePath: string, mimeType: string): Promise<ProcessResult> {
  const content = await readFile(outputPath);
  return { localPath: outputPath, relativePath: relative(workspacePath, outputPath).replaceAll("\\", "/"), mimeType, byteLength: content.byteLength, sha256: createHash("sha256").update(new Uint8Array(content)).digest("hex") };
}

function executableCandidates(name: "ffmpeg" | "ffprobe") {
  const envKey = name === "ffmpeg" ? "COWORKANY_FFMPEG_PATH" : "COWORKANY_FFPROBE_PATH";
  const binary = process.env[envKey];
  const extension = process.platform === "win32" ? ".exe" : "";
  const mediaDirectory = process.env.COWORKANY_MEDIA_DIR;
  return [
    ...(binary ? [binary] : []),
    ...(mediaDirectory ? [join(mediaDirectory, `${name}${extension}`)] : []),
    join(process.env.COWORKANY_RUNTIME_DIR ?? "", "media", `${name}${extension}`),
    join(process.cwd(), "media", `${name}${extension}`),
    `${name}${extension}`,
  ];
}

function runProcess(command: string, args: readonly string[], signal?: AbortSignal) {
  return new Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>((resolveProcess, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const abort = () => { child.kill(); reject(Object.assign(new Error("workflow_cancelled"), { name: "AbortError" })); };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolveProcess({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runTool(name: "ffmpeg" | "ffprobe", args: readonly string[], signal?: AbortSignal) {
  let lastError: unknown;
  for (const candidate of executableCandidates(name)) {
    try {
      const result = await runProcess(candidate, args, signal);
      if (result.code === 0) return result;
      lastError = new Error(result.stderr.trim() || `${name}_failed`);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "runtime_missing";
  throw new Error(`ffmpeg_runtime_missing:${name}:${message}`);
}

function flatten(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flatten) : value === undefined || value === null ? [] : [value];
}

function localPath(value: unknown, workspacePath: string): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const candidate = resolve(workspacePath, value);
    return existsSync(candidate) ? candidate : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const candidate = typeof record.localPath === "string" ? record.localPath : typeof record.relativePath === "string" ? resolve(workspacePath, record.relativePath) : "";
  return candidate && existsSync(candidate) ? resolve(candidate) : undefined;
}

function inputFiles(value: unknown, workspacePath: string) {
  return flatten(value).map((item) => localPath(item, workspacePath)).filter((item): item is string => Boolean(item));
}

async function probeMedia(path: string, signal?: AbortSignal): Promise<Probe> {
  const result = await runTool("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path], signal);
  let parsed: { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  try { parsed = JSON.parse(result.stdout) as typeof parsed; } catch { throw new Error(`ffprobe_invalid_output:${path}`); }
  return {
    duration: Number.isFinite(Number(parsed.format?.duration)) ? Math.max(0, Number(parsed.format?.duration)) : 0,
    hasAudio: (parsed.streams ?? []).some((stream) => stream.codec_type === "audio"),
    hasVideo: (parsed.streams ?? []).some((stream) => stream.codec_type === "video"),
  };
}

export async function detectMediaStreams(value: unknown, workspacePath: string, signal?: AbortSignal): Promise<{ readonly hasAudio: boolean; readonly hasVideo: boolean } | undefined> {
  const path = localPath(value, workspacePath);
  if (!path) return undefined;
  try {
    const probe = await probeMedia(path, signal);
    return { hasAudio: probe.hasAudio, hasVideo: probe.hasVideo };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return undefined;
  }
}

function safePart(value: string) { return value.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 120) || "workflow"; }
function asNumber(value: unknown, fallback: number) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function outputFilter(config: Record<string, unknown>) {
  const ratio = config.ratio === "16:9" ? "16:9" : config.ratio === "1:1" ? "1:1" : "9:16";
  const defaultSize = ratio === "16:9" ? [1920, 1080] : ratio === "1:1" ? [1080, 1080] : [1080, 1920];
  const usesPortraitDefaults = config.width === 1080 && config.height === 1920 && ratio !== "9:16";
  const width = Math.max(1, Math.round(usesPortraitDefaults ? defaultSize[0] : asNumber(config.width, defaultSize[0])));
  const height = Math.max(1, Math.round(usesPortraitDefaults ? defaultSize[1] : asNumber(config.height, defaultSize[1])));
  const fps = Math.max(1, Math.round(asNumber(config.fps, 30)));
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
}

function escapeConcatPath(path: string) { return path.replaceAll("'", "'\\''"); }
function escapeFilterPath(path: string) { return path.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'"); }

async function buildFfmpegArgs(operation: string, config: Record<string, unknown>, videos: string[], audios: string[], images: string[], text: string, outputPath: string, tempDirectory: string, probes: Probe[]) {
  if (operation === "stitch") {
    if (config.transition === "fade" && videos.length > 1) {
      const duration = Math.max(0.05, Math.min(10, asNumber(config.transitionDurationMs, 300) / 1000));
      const filters = videos.map((_, index) => `[${index}:v]${outputFilter(config)},setpts=PTS-STARTPTS[v${index}]`);
      let previous = "v0";
      let offset = Math.max(0, (probes[0]?.duration ?? 0) - duration);
      for (let index = 1; index < videos.length; index += 1) {
        const next = `xfade${index}`;
        filters.push(`[${previous}][v${index}]xfade=transition=fade:duration=${duration}:offset=${Math.max(0, offset)}[${next}]`);
        previous = next;
        offset += Math.max(0, (probes[index]?.duration ?? 0) - duration);
      }
      return [...videos.flatMap((path) => ["-i", path]), "-filter_complex", filters.join(";"), "-map", `[${previous}]`, "-map", "0:a?", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputPath];
    }
    const concatPath = join(tempDirectory, "inputs.txt");
    await writeFile(concatPath, videos.map((path) => `file '${escapeConcatPath(path)}'`).join("\n"), "utf8");
    return ["-f", "concat", "-safe", "0", "-i", concatPath, "-vf", outputFilter(config), "-c:v", "libx264", "-c:a", "aac", "-ar", "48000", "-movflags", "+faststart", outputPath];
  }
  if (operation === "transform") return ["-i", videos[0], "-vf", outputFilter(config), "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputPath];
  if (operation === "overlay") return ["-i", videos[0], "-i", images[0], "-filter_complex", `[0:v]${outputFilter(config)}[base];[1:v]format=rgba,colorchannelmixer=aa=${Math.max(0, Math.min(1, asNumber(config.overlayOpacity, 1)))}[overlay];[base][overlay]overlay=shortest=1[v]`, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-c:a", "aac", "-shortest", outputPath];
  if (operation === "subtitle") {
    const subtitlePath = join(tempDirectory, `captions.${config.subtitleFormat === "ass" ? "ass" : "srt"}`);
    await writeFile(subtitlePath, text, "utf8");
    const subtitleFilter = `subtitles='${escapeFilterPath(subtitlePath)}'`;
    return ["-i", videos[0], "-vf", `${outputFilter(config)},${subtitleFilter}`, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputPath];
  }
  if (operation === "mux") return ["-i", videos[0], "-i", audios[0], "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", outputPath];
  if (operation === "trim") return ["-i", audios[0], "-ss", String(Math.max(0, asNumber(config.startSeconds, 0))), ...(asNumber(config.endSeconds, 0) > 0 ? ["-to", String(asNumber(config.endSeconds, 0))] : []), "-vn", "-c:a", "aac", outputPath];
  if (operation === "mix") return [
    ...audios.flatMap((path) => ["-i", path]),
    "-filter_complex", `${audios.map((_, index) => `[${index}:a]volume=${index === 0 ? asNumber(config.voiceoverGainDb, 0) : asNumber(config.musicGainDb, -8)}dB[a${index}]`).join(";")};${audios.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audios.length}:duration=longest:dropout_transition=2,loudnorm=I=${asNumber(config.targetLoudnessMix, -16)}:TP=-1.5:LRA=11[a]`, "-map", "[a]", "-c:a", "aac", outputPath,
  ];
  if (operation === "normalize") return ["-i", audios[0], "-af", `loudnorm=I=${asNumber(config.targetLoudness, -16)}:TP=-1.5:LRA=11`, "-vn", "-c:a", "aac", outputPath];
  throw new Error(`workflow_process_operation_unsupported:${operation}`);
}

export async function runFfmpegMediaProcess(options: MediaProcessOptions): Promise<ProcessResult> {
  const operation = getWorkflowProcessOperation(options.nodeType, options.config);
  const videos = inputFiles(options.inputs.videos ?? options.inputs.video, options.workspacePath);
  const audios = inputFiles(options.inputs.audios ?? options.inputs.audio, options.workspacePath);
  const images = inputFiles(options.inputs.images ?? options.inputs.image, options.workspacePath);
  const text = flatten(options.inputs.text).filter((item): item is string => typeof item === "string").join("\n");
  const inputPaths = options.nodeType === "audio_process" ? audios : videos;
  const required = operation === "mux" ? [...videos, ...audios] : operation === "overlay" ? [...videos, ...images] : inputPaths;
  if (!required.length || required.some((path) => !existsSync(path))) throw new Error(`workflow_process_local_input_required:${operation}`);
  const probes = await Promise.all(inputPaths.map((path) => probeMedia(path, options.signal)));
  const outputDirectory = join(options.workspacePath, "artifacts", safePart(options.runId), safePart(options.nodeKey));
  await mkdir(outputDirectory, { recursive: true });
  const extension = options.nodeType === "audio_process" ? "m4a" : "mp4";
  const outputPath = join(outputDirectory, `${safePart(operation)}.${extension}`);
  const mimeType = options.nodeType === "audio_process" ? "audio/mp4" : "video/mp4";
  if (existsSync(outputPath)) return resultFor(outputPath, options.workspacePath, mimeType);
  const tempDirectory = join(outputDirectory, ".tmp");
  await mkdir(tempDirectory, { recursive: true });
  const tempOutput = join(tempDirectory, `${safePart(operation)}.${extension}`);
  const args = await buildFfmpegArgs(operation, options.config, videos, audios, images, text, tempOutput, tempDirectory, probes);
  options.onProgress?.(0.05, `ffmpeg:${operation}:started`);
  const result = await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], options.signal);
  if (result.code !== 0 || !existsSync(tempOutput)) throw new Error(`ffmpeg_process_failed:${result.stderr.trim() || operation}`);
  await rename(tempOutput, outputPath);
  options.onProgress?.(1, `ffmpeg:${operation}:completed`);
  return resultFor(outputPath, options.workspacePath, mimeType);
}
