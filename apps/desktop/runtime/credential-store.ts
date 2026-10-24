import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Host-only. Values are opaque serialized records and must never enter config or diagnostics. */
export interface CredentialStore {
  get(reference: string): Promise<string | undefined>;
  /** true means OS-protected durable storage; false means this process only. */
  set(reference: string, value: string): Promise<boolean>;
  delete(reference: string): Promise<void>;
}

export type CredentialCommandRunner = (command: string, args: readonly string[], input?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const runCommand: CredentialCommandRunner = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => { child.kill(); reject(new Error("credential_store_timeout")); }, 15_000);
  child.stdout.setEncoding("utf8").on("data", (data: string) => { stdout += data; if (stdout.length > 2_000_000) child.kill(); });
  child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr += data; if (stderr.length > 32_000) child.kill(); });
  child.once("error", () => { clearTimeout(timer); reject(new Error("credential_store_unavailable")); });
  child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
});

function validReference(reference: string): void {
  if (!/^cheapbuddy\/account\/[a-zA-Z0-9._-]{1,128}$/u.test(reference)) throw new Error("credential_reference_invalid");
}

function securityQuoted(value: string): string {
  if (value.includes("\r") || value.includes("\n") || value.includes("\0")) throw new Error("credential_record_invalid");
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

const WINDOWS_READ = "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; if(Test-Path -LiteralPath $r.path){ $b=[IO.File]::ReadAllBytes($r.path); $v=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($v)) }";
const WINDOWS_WRITE = "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $b=[Text.Encoding]::UTF8.GetBytes($r.value); $v=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($r.path,$v)";

/** No secret is passed in argv. Missing OS tools fall back to memory, never plaintext files. */
export function createCredentialStore(options: {
  readonly platform?: NodeJS.Platform;
  readonly dataDirectory?: string;
  readonly runner?: CredentialCommandRunner;
} = {}): CredentialStore {
  const platform = options.platform ?? process.platform;
  const directory = options.dataDirectory ?? join(homedir(), ".coworkany", "credentials");
  const runner = options.runner ?? runCommand;
  const memory = new Map<string, string>();
  const sessionOnly = new Set<string>();
  const durable = new Set<string>();
  const service = "cc.coworkany.cheapbuddy";
  const fileFor = (reference: string) => join(directory, `${createHash("sha256").update(reference).digest("hex")}.dpapi`);
  const windowsArgs = (script: string) => ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; ${script}`];

  async function nativeRead(reference: string): Promise<string | undefined> {
    let result;
    if (platform === "darwin") result = await runner("/usr/bin/security", ["find-generic-password", "-s", service, "-a", reference, "-w"]);
    else if (platform === "win32") result = await runner("powershell.exe", windowsArgs(WINDOWS_READ), JSON.stringify({ path: fileFor(reference) }));
    else if (platform === "linux") result = await runner("secret-tool", ["lookup", "provider", "cheapbuddy", "reference", reference]);
    else return undefined;
    if (result.code !== 0) throw new Error("credential_store_unavailable");
    return result.stdout.trim() || undefined;
  }

  return {
    async get(reference) {
      validReference(reference);
      if (memory.has(reference) || sessionOnly.has(reference)) return memory.get(reference);
      try {
        const value = await nativeRead(reference);
        if (value) { memory.set(reference, value); durable.add(reference); }
        return value;
      } catch { return undefined; }
    },
    async set(reference, value) {
      validReference(reference);
      memory.set(reference, value);
      try {
        let result;
        if (platform === "darwin") {
          // security's interactive parser receives the password only through stdin.
          const command = `add-generic-password -U -s ${securityQuoted(service)} -a ${securityQuoted(reference)} -w ${securityQuoted(value)}\n`;
          result = await runner("/usr/bin/security", ["-i"], command);
          if (result.code !== 0 || /(?:SecKeychain|Error:|failed|could not)/iu.test(result.stderr)) throw new Error("credential_store_write_failed");
          // Interactive security can exit successfully after a failed command. Verify the stored value.
          if (await nativeRead(reference) !== value) throw new Error("credential_store_write_failed");
        } else if (platform === "win32") {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          result = await runner("powershell.exe", windowsArgs(WINDOWS_WRITE), JSON.stringify({ path: fileFor(reference), value }));
          if (result.code !== 0) throw new Error("credential_store_write_failed");
        } else if (platform === "linux") {
          result = await runner("secret-tool", ["store", "--label=Coworkany CheapBuddy", "provider", "cheapbuddy", "reference", reference], value);
          if (result.code !== 0) throw new Error("credential_store_write_failed");
        } else throw new Error("credential_store_unavailable");
        sessionOnly.delete(reference);
        durable.add(reference);
        return true;
      } catch {
        sessionOnly.add(reference);
        return false;
      }
    },
    async delete(reference) {
      validReference(reference);
      memory.delete(reference);
      sessionOnly.add(reference);
      // A failed deletion of a known durable record is surfaced to the account service.
      try {
        if (platform === "darwin") {
          const result = await runner("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", reference]);
          if (result.code !== 0 && !/could not be found/iu.test(result.stderr)) throw new Error("credential_store_clear_failed");
        } else if (platform === "win32") {
          await unlink(fileFor(reference)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw new Error("credential_store_clear_failed"); });
        } else if (platform === "linux") {
          const result = await runner("secret-tool", ["clear", "provider", "cheapbuddy", "reference", reference]);
          if (result.code !== 0) throw new Error("credential_store_clear_failed");
        }
        durable.delete(reference);
      } catch { if (durable.has(reference)) throw new Error("credential_store_clear_failed"); }
    },
  };
}
