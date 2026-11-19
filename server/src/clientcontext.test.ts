import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

/** A stand-in mail server that records the headers of every request. */
const seen: IncomingHttpHeaders[] = [];
const upstream = createServer((req, res) => {
  seen.push(req.headers);
  res.writeHead(404);
  res.end();
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
process.env.MAIL_SERVER_URL = base;
process.env.APP_SECRET = "test-secret-for-client-context";
// The webmail believes X-Forwarded-For from loopback, as from an ingress
process.env.TRUSTED_PROXIES = "127.0.0.1/32,::1/128";

const { upstreamFetch, withClientIp } = await import("./clientcontext.js");
const { createApp } = await import("./app.js");
const { clearLogoCache } = await import("./logo.js");

test.after(() => upstream.close());

test("a request to the mail server carries the browser's address, replacing what it sent", async () => {
  await withClientIp("203.0.113.7", () => upstreamFetch(`${base}/x`, { headers: { "x-forwarded-for": "198.51.100.1" } }));
  assert.equal(seen.at(-1)!["x-forwarded-for"], "203.0.113.7");
});

test("outside a request, or with no usable address, nothing is added", async () => {
  await upstreamFetch(`${base}/x`);
  assert.equal(seen.at(-1)!["x-forwarded-for"], undefined);
  await withClientIp("unknown", () => upstreamFetch(`${base}/x`));
  assert.equal(seen.at(-1)!["x-forwarded-for"], undefined);
});

test("the app passes on the address it resolved for the request", async () => {
  const { serve } = await import("@hono/node-server");
  const server = serve({ fetch: createApp().fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    clearLogoCache();
    const port = (server.address() as AddressInfo).port;
    // As through an ingress: the browser's spoof first, the ingress's view last
    await fetch(`http://127.0.0.1:${port}/api/logo?domain=example.org`, {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9", "sec-fetch-dest": "image" },
    });
    const logo = seen.findLast((h) => h["x-forwarded-for"] !== undefined);
    assert.equal(logo?.["x-forwarded-for"], "203.0.113.9");
  } finally {
    server.close();
  }
});
