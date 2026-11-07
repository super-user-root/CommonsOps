import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const reservation = createServer();
await new Promise((resolve) =>
  reservation.listen(0, "127.0.0.1", () => resolve(undefined)),
);
const address = reservation.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve(undefined))),
);
const server = spawn(
  process.execPath,
  [
    requireWeb.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: webRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (chunk) => {
  output += String(chunk);
});
server.stderr.on("data", (chunk) => {
  output += String(chunk);
});
const exited = new Promise((resolve) => server.once("exit", resolve));
const url = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Production server exited: ${output}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Startup may not have bound the port yet. */
    }
    await delay(200);
  }
  assert.ok(ready, `Production server did not become ready: ${output}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="en"/);
  assert.match(html, /<title>CommonsOps \| Testnet workspace<\/title>/);
  assert.match(html, /Testnet workspace/);
  assert.match(
    html,
    /Live testnet reads, wallet-signed transactions, recorded payout\s+proof\./,
  );
  assert.match(
    html,
    /No keys\. No fabricated records\. DAO payouts stay in the DAO\./,
  );
  // The live surface replaced the read-only boundary: the header now offers a
  // real wallet connection and the stale "unavailable" copy must be gone.
  assert.doesNotMatch(html, /Wallet unavailable/);
  assert.match(html, /Connect testnet wallet/);
  assert.ok(
    !/<form\b/.test(html),
    "Workspace must not present a transaction form: contributor actions are single wallet-signed sends",
  );
  assert.ok(
    /<button[^>]*disabled/.test(html),
    "Recorded intent previews must render disabled",
  );
  assert.equal(
    (await fetch(`${url}/not-a-route`, { signal: AbortSignal.timeout(5000) }))
      .status,
    404,
  );
  console.log(
    "PASS production HTTP smoke: testnet workspace, live surface, metadata, 404",
  );
} finally {
  server.kill();
  await exited;
}
