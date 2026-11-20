import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

const { drain, endStreams, isDraining, onStreamsEnd, resetDrain } = await import("./drain.js");
const { createApp } = await import("./app.js");

test("health answers 503 while draining, with Connection: close", async () => {
  resetDrain();
  const app = createApp();
  let res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("connection"), null);
  const server = createServer();
  const done = drain(server, 50, 50, () => {});
  assert.equal(isDraining(), true);
  res = await app.request("/api/health");
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { draining?: boolean }).draining, true);
  assert.equal(res.headers.get("connection"), "close");
  await done;
  resetDrain();
});

test("every live stream is ended once, and one that ended first is left alone", () => {
  resetDrain();
  let a = 0, b = 0;
  onStreamsEnd(() => { a++; });
  const off = onStreamsEnd(() => { b++; });
  off();
  assert.equal(endStreams(), 1);
  assert.equal(endStreams(), 0);
  assert.deepEqual([a, b], [1, 0]);
  resetDrain();
});

test("a stream opened after the streams ended is ended at once", async () => {
  resetDrain();
  endStreams();
  let ended = false;
  onStreamsEnd(() => { ended = true; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ended, true);
  resetDrain();
});

test("a request in flight finishes before the server stops", async () => {
  resetDrain();
  const server = createServer((_req, res) => { setTimeout(() => res.end("done"), 150); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const body = new Promise<string>((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: "/" }, (res) => {
      let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve(d));
    }).on("error", reject).end();
  });
  await new Promise((r) => setTimeout(r, 20));
  await drain(server, 0, 2_000, () => {});
  assert.equal(await body, "done");
  resetDrain();
});

test("a request still open at the timeout is closed, and the drain still returns", async () => {
  resetDrain();
  const server = createServer(() => { /* never answers */ });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const failed = new Promise<boolean>((resolve) => {
    request({ host: "127.0.0.1", port, path: "/" }, () => resolve(false)).on("error", () => resolve(true)).end();
  });
  await new Promise((r) => setTimeout(r, 20));
  const t = Date.now();
  await drain(server, 0, 100, () => {});
  assert.ok(Date.now() - t < 1_000);
  assert.equal(await failed, true);
  resetDrain();
});
