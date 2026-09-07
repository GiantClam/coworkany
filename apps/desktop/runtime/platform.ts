import { homedir } from "node:os";
import { join } from "node:path";

export type DesktopRuntimeTarget = "windows-x64" | "macos-arm64";

export interface DesktopPlatform {
  readonly target: DesktopRuntimeTarget;
  readonly nodeExecutable: string;
  readonly openCodeExecutable: string;
  readonly pythonExecutable: string;
  readonly fontAsset: string;
  readonly portableDataDirectory: string;
  readonly userDataRoot: string;
}

export function desktopPlatform(options: {
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly localAppData?: string;
  readonly homeDirectory?: string;
} = {}): DesktopPlatform {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const homeDirectory = options.homeDirectory ?? homedir();

  if (platform === "win32") {
    return {
      target: "windows-x64",
      nodeExecutable: "node.exe",
      openCodeExecutable: "opencode.exe",
      pythonExecutable: "python.exe",
      fontAsset: "msyh.ttc",
      portableDataDirectory: "data",
      userDataRoot: join(options.localAppData ?? process.env.LOCALAPPDATA ?? join(process.env.TEMP ?? ".", "LocalAppData"), "CoworkAny"),
    };
  }

  if (platform === "darwin" && architecture === "arm64") {
    return {
      target: "macos-arm64",
      nodeExecutable: "node",
      openCodeExecutable: "opencode",
      pythonExecutable: "python3",
      fontAsset: "NotoSansCJKsc-Regular.otf",
      portableDataDirectory: "CoworkAny Data",
      userDataRoot: join(homeDirectory, "Library", "Application Support", "CoworkAny"),
    };
  }

  throw new Error(`desktop_platform_unsupported:${platform}-${architecture}`);
}
