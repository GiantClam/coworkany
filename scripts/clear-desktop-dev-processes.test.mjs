import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { clearDesktopDevProcesses, parseWindowsListeningPids, shouldRefusePortKill } from "./clear-desktop-dev-processes.mjs";

test("desktop dev cleanup finds every Windows listener on the configured port once", () => {
  const output = [
    "  TCP    127.0.0.1:1420      0.0.0.0:0      LISTENING       1234",
    "  TCP    0.0.0.0:1420        0.0.0.0:0      LISTENING       1234",
    "  TCP    [::1]:1420          [::]:0         LISTENING       5678",
    "  TCP    127.0.0.1:1421      0.0.0.0:0      LISTENING       9999",
    "  TCP    127.0.0.1:1420      0.0.0.0:0      ESTABLISHED     1111",
  ].join("\n");
  assert.deepEqual(parseWindowsListeningPids(output, 1420), [1234, 5678]);
});

test("PoC cleanup refuses to kill an occupied port", async () => {
  assert.equal(shouldRefusePortKill({ COWORKANY_DESKTOP_POC_NO_PORT_KILL: "1" }), true);
  assert.equal(shouldRefusePortKill({ COWORKANY_DESKTOP_POC_NO_PORT_KILL: "0" }), false);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const previous = process.env.COWORKANY_DESKTOP_POC_NO_PORT_KILL;
  process.env.COWORKANY_DESKTOP_POC_NO_PORT_KILL = "1";
  try {
    await assert.rejects(clearDesktopDevProcesses(address.port), (error) => error instanceof Error && error.message === `dev_port_occupied:${address.port}`);
  }
  finally {
    if (previous === undefined) delete process.env.COWORKANY_DESKTOP_POC_NO_PORT_KILL;
    else process.env.COWORKANY_DESKTOP_POC_NO_PORT_KILL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
