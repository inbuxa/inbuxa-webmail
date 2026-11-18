import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";

/**
 * A stand-in for the mail server's `GET /logo` (branding BT-5, BT-27): it
 * answers by the query it was asked, and counts the requests.
 */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const asked: { url: string; dest: string | undefined }[] = [];
const upstream = createServer((req, res) => {
  asked.push({ url: req.url ?? "", dest: req.headers["sec-fetch-dest"] as string | undefined });
  const url = new URL(req.url ?? "/", "http://x");
  const domain = url.searchParams.get("domain") ?? "";
  const dark = url.searchParams.get("theme") === "dark";
  if (domain === "image.example") {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(dark ? Buffer.concat([PNG, Buffer.from("dark")]) : PNG);
  } else if (domain === "url.example") {
    res.writeHead(302, { location: "https://cdn.example/logo.png" });
    res.end();
  } else if (domain === "plain-http.example") {
    res.writeHead(302, { location: "http://cdn.example/logo.png" });
    res.end();
  } else if (domain === "html.example") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<b>x</b>");
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
process.env.MAIL_SERVER_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
process.env.APP_SECRET = "test-secret-for-logo";

const { logoHandler, cleanDomain, clearLogoCache } = await import("./logo.js");

const app = new Hono();
app.get("/api/logo", logoHandler);
const get = (query: string, dest = "image") => app.request(`/api/logo${query}`, { headers: { "sec-fetch-dest": dest } });

test.after(() => upstream.close());

test("a logo stored as an image is passed on with the server's protections", async () => {
  clearLogoCache();
  const res = await get("?domain=image.example");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("cache-control") ?? "", /max-age=300/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
});

// inbuxa-server #410: the dark theme asks for the dark-mode logo
test("theme=dark is passed on, and kept apart from the light answer", async () => {
  clearLogoCache();
  const dark = Buffer.from(await (await get("?domain=image.example&theme=dark")).arrayBuffer());
  const light = Buffer.from(await (await get("?domain=image.example")).arrayBuffer());
  assert.ok(dark.toString().endsWith("dark"));
  assert.deepEqual(light, PNG);
  assert.ok(asked.some((a) => a.url === "/logo?domain=image.example&theme=dark"));
});

test("answers are kept, so a page load isn't a request to the server", async () => {
  clearLogoCache();
  const before = asked.length;
  await get("?domain=image.example");
  await get("?domain=image.example");
  await get("?domain=image.example");
  assert.equal(asked.length - before, 1);
});

test("a URL logo goes through the image proxy, and only for an image load", async () => {
  clearLogoCache();
  const res = await get("?domain=url.example");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/api/image?url=${encodeURIComponent("https://cdn.example/logo.png")}`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  // Opened as a page, it sends nobody anywhere
  assert.equal((await get("?domain=url.example", "document")).status, 404);
  // The server is asked as an image load, and its redirect never followed
  assert.ok(asked.filter((a) => a.url.includes("url.example")).every((a) => a.dest === "image"));
  assert.ok(!asked.some((a) => a.url.includes("cdn.example")));
});

test("no logo, an http: URL or something that isn't an image is a 404", async () => {
  clearLogoCache();
  for (const query of ["", "?domain=none.example", "?domain=plain-http.example", "?domain=html.example"]) {
    assert.equal((await get(query)).status, 404, query);
  }
});

test("only a domain name is passed on", () => {
  assert.equal(cleanDomain("Example.ORG."), "example.org");
  assert.equal(cleanDomain("a.example&theme=x"), "");
  assert.equal(cleanDomain("../logo"), "");
  assert.equal(cleanDomain(undefined), "");
  assert.equal(cleanDomain("a".repeat(254)), "");
});
