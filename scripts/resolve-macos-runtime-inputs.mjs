import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const ENV_NAMES = {
  node: "COWORKANY_MAC_NODE_RUNTIME_DIR",
  opencode: "COWORKANY_MAC_OPENCODE_RUNTIME_DIR",
  python: "COWORKANY_MAC_PYTHON_RUNTIME_DIR",
  font: "COWORKANY_MAC_FONT_PATH",
  ffmpeg: "COWORKANY_MAC_FFMPEG_PATH",
  ffprobe: "COWORKANY_MAC_FFPROBE_PATH",
  staticFfmpeg: "COWORKANY_MAC_STATIC_FFMPEG_PATH",
  staticFfprobe: "COWORKANY_MAC_STATIC_FFPROBE_PATH",
};

const exists = async (path, mode = constants.F_OK) => access(path, mode).then(() => true, () => false);

async function executableDirectory(candidate, executable) {
  if (!candidate) return null;
  const path = resolve(candidate);
  if (!(await exists(path))) return null;
  const details = await stat(path).catch(() => null);
  if (!details?.isDirectory()) return null;
  if (await exists(join(path, executable), constants.X_OK)) return path;
  if (await exists(join(path, "bin", executable), constants.X_OK)) return path;
  return null;
}

async function executableFromPath(name, pathEnv = process.env.PATH) {
  for (const directory of (pathEnv ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    if (await exists(candidate, constants.X_OK)) return realpath(candidate).catch(() => candidate);
  }
  return null;
}

async function firstExecutableDirectory(candidates, executable) {
  for (const candidate of candidates) {
    const result = await executableDirectory(candidate, executable);
    if (result) return result;
  }
  return undefined;
}

async function runtimeRootFromExecutable(executable, name) {
  if (!executable) return undefined;
  const binary = await realpath(executable).catch(() => executable);
  const candidates = [dirname(dirname(binary)), dirname(binary)];
  return firstExecutableDirectory(candidates, name);
}

function firstDefined(...values) {
  return values.find(value => typeof value === "string" && value.trim())?.trim();
}

async function firstExisting(...values) {
  for (const value of values) {
    if (value && await exists(value)) return value;
  }
  return undefined;
}

/**
 * Resolve local macOS build inputs. Explicit COWORKANY_MAC_* values always win;
 * automatic discovery is only a developer convenience and is never used by CI
 * when the approved archive preparation step provides those variables.
 */
export async function resolveMacOSRuntimeInputs({
  env = process.env,
  platform = process.platform,
  architecture = process.arch,
  execPath = process.execPath,
  homeDirectory = homedir(),
  pathEnv = env.PATH,
} = {}) {
  if (platform !== "darwin" || !["arm64", "x64"].includes(architecture)) return {};

  const explicit = Object.fromEntries(Object.entries(ENV_NAMES).map(([key, name]) => [key, env[name]]));
  const node = explicit.node?.trim() || await runtimeRootFromExecutable(execPath, "node");

  const opencodeBinary = await executableFromPath("opencode", pathEnv);
  const opencode = explicit.opencode?.trim() || await firstExecutableDirectory(
    [join(homeDirectory, ".opencode"), ...(opencodeBinary ? [dirname(opencodeBinary), dirname(dirname(opencodeBinary))] : [])],
    "opencode",
  );

  const pythonBinary = await executableFromPath("python3", pathEnv);
  const pythonFrameworkRoot = join("/Library/Frameworks/Python.framework/Versions");
  const python = explicit.python?.trim() || await firstExecutableDirectory(
    [
      await runtimeRootFromExecutable(pythonBinary, "python3"),
      join(pythonFrameworkRoot, "Current"),
      join(pythonFrameworkRoot, "3.13"),
      join(pythonFrameworkRoot, "3.12"),
    ],
    "python3",
  );

  const mediaPath = async (explicitPath, name) => firstDefined(explicitPath, await executableFromPath(name, pathEnv));
  const ffmpeg = await mediaPath(explicit.ffmpeg, "ffmpeg");
  const ffprobe = await mediaPath(explicit.ffprobe, "ffprobe");
  const staticFfmpeg = firstDefined(explicit.staticFfmpeg);
  const staticFfprobe = firstDefined(explicit.staticFfprobe);

  const fontCandidates = [
    join(homeDirectory, "Library/Fonts/NotoSansCJKsc-Regular.otf"),
    "/opt/homebrew/share/fonts/NotoSansCJKsc-Regular.otf",
    "/usr/local/share/fonts/NotoSansCJKsc-Regular.otf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
  ];
  const font = explicit.font?.trim() || await firstExisting(...fontCandidates);

  const source = {
    node,
    opencode,
    python,
    font,
    ffmpeg,
    ffprobe,
    staticFfmpeg,
    staticFfprobe,
  };

  // Keep the resolver independent from the staging command while allowing a
  // caller to show actionable names for every missing local input.
  return source;
}

export function missingMacOSRuntimeInputs(source) {
  const missing = [];
  if (!source.node) missing.push(`node=${ENV_NAMES.node}`);
  if (!source.opencode) missing.push(`opencode=${ENV_NAMES.opencode}`);
  if (!source.python) missing.push(`python=${ENV_NAMES.python}`);
  if (!source.font) missing.push(`font=${ENV_NAMES.font}`);
  if (!(source.staticFfmpeg ?? source.ffmpeg)) missing.push(`ffmpeg=${ENV_NAMES.staticFfmpeg} or ${ENV_NAMES.ffmpeg}`);
  if (!(source.staticFfprobe ?? source.ffprobe)) missing.push(`ffprobe=${ENV_NAMES.staticFfprobe} or ${ENV_NAMES.ffprobe}`);
  return missing;
}

export { ENV_NAMES };
