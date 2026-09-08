import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

test("macOS release rejects development certificates before touching the app", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/release-macos.sh"], {
      env: {
        ...process.env,
        OSTYPE: "darwin23",
        COWORKANY_MAC_APP_PATH: "/tmp/CoworkAny.app",
        COWORKANY_RELEASE_VERSION: "0.1.3",
        APPLE_CERTIFICATE: "Y2VydA==",
        APPLE_CERTIFICATE_PASSWORD: "fixture",
        APPLE_SIGNING_IDENTITY: "Apple Development: Test",
        APPLE_ID: "test@example.com",
        APPLE_PASSWORD: "fixture",
        APPLE_TEAM_ID: "TEAM",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stderr }));
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /macos_release_identity_requires_developer_id_application/);
});

for (const rejection of ["none", "app", "dmg"]) {
  test(`macOS signing pipeline: ${rejection === "none" ? "accepted" : `reject ${rejection}`} notarization`, async t => {
    const root = await mkdtemp(join(tmpdir(), "coworkany-sign-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin"), app = join(root, "CoworkAny.app"), log = join(root, "calls.log");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await mkdir(join(app, "Contents/Resources/runtime"), { recursive: true });
    await mkdir(bin);
    for (const path of ["Contents/MacOS/coworkany", "Contents/Resources/runtime/node", "Contents/Resources/runtime/library.node"]) await writeFile(join(app, path), "stub");
    const stubs = {
      codesign: 'exit 0',
      security: '[ "$#" -eq 3 ] && printf \'"/tmp/original.keychain"\\n\'; exit 0',
      xcrun: `if [ "$1" = notarytool ]; then
        case "$3" in *.zip) kind=app;; *) kind=dmg;; esac
        if [ "$kind" = "$COWORKANY_STUB_REJECT" ]; then printf '{"status":"Invalid"}'; else printf '{"status":"Accepted"}'; fi
      fi
      exit 0`,
      hdiutil: 'for last do :; done; touch "$last"',
      ditto: 'for last do :; done; touch "$last"',
      spctl: 'exit 0',
      uuidgen: 'printf test-key',
      file: 'case "$2" in *.node) printf "Mach-O 64-bit bundle arm64";; *) printf "Mach-O 64-bit executable arm64";; esac',
      base64: 'cat >/dev/null; printf cert',
      node: 'exit 0',
    };
    for (const [name, source] of Object.entries(stubs)) {
      const path = join(bin, name);
      await writeFile(path, `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> "$COWORKANY_STUB_LOG"\n${source}\n`);
      await chmod(path, 0o755);
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn("bash", ["scripts/release-macos.sh"], {
        env: { ...process.env, OSTYPE: "darwin23", PATH: `${bin}:${process.env.PATH}`, COWORKANY_STUB_LOG: log,
          COWORKANY_STUB_REJECT: rejection, COWORKANY_MAC_APP_PATH: app,
          COWORKANY_MAC_PORTABLE_OUTPUT: join(root, "output"), COWORKANY_RELEASE_VERSION: "0.1.3",
          APPLE_CERTIFICATE: "Y2VydA==", APPLE_CERTIFICATE_PASSWORD: "fixture", APPLE_SIGNING_IDENTITY: "Developer ID Application: Test",
          APPLE_ID: "test@example.com", APPLE_PASSWORD: "fixture", APPLE_TEAM_ID: "TEAM" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, stderr }));
    });
    const calls = await readFile(log, "utf8");
    if (rejection === "none") {
      assert.equal(result.code, 0, result.stderr);
      assert.match(calls, /stapler validate .*CoworkAny-0.1.3-macOS-arm64.dmg/);
      assert.match(calls, /node .*package-macos-portable.mjs/);
      assert.ok(calls.lastIndexOf("stapler validate") < calls.indexOf("package-macos-portable.mjs"));
    } else {
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`macos_${rejection}_notarization_not_accepted`));
      assert.doesNotMatch(calls, /package-macos-portable/);
    }
    const submissions = calls.split("\n").filter(line => line.startsWith("xcrun notarytool submit"));
    assert.equal(submissions.length, rejection === "app" ? 1 : 2);
    assert.ok(calls.indexOf("codesign") < calls.indexOf("notarytool"));
    const signatures = calls.split("\n").filter(line => line.startsWith("codesign --force"));
    assert.match(signatures.find(line => line.endsWith("/runtime/node")), /--entitlements/);
    assert.doesNotMatch(signatures.find(line => line.endsWith("/runtime/library.node")), /--entitlements/);
    assert.doesNotMatch(signatures.find(line => line.endsWith("/MacOS/coworkany")), /--entitlements/);
    assert.doesNotMatch(signatures.join("\n"), /--deep/);
    assert.match(calls, /security delete-keychain/);
    assert.match(calls, /security list-keychains -d user -s \/tmp\/original\.keychain/);
  });
}
