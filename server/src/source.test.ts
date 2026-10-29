import { test } from "node:test";
import assert from "node:assert/strict";
process.env.MAIL_SERVER_URL = "http://127.0.0.1:1";
const { createApp } = await import("./app.js");
const { config } = await import("./config.js");
const { sourceDocument } = await import("./source.js");

const COMMIT = "e8249751c2a1d5e8b7f6a9c0d1e2f3a4b5c6d7e8";
const REPOSITORY = "https://git.coffeylabs.org/inbuxa/inbuxa-webmail";

test("the document names the repository and the commit", () => {
  const doc = JSON.parse(sourceDocument({ version: "27.1-rc.1", repository: REPOSITORY, revision: COMMIT })!);
  assert.deepEqual(doc, {
    version: 1,
    software: [
      { name: "inbuxa Webmail", version: "27.1-rc.1", license: "AGPL-3.0-or-later", repository: REPOSITORY, revision: COMMIT },
    ],
  });
});

test("without a full commit id there is no document", () => {
  for (const revision of [null, "", "e824975", "inbuxa-v27.1-rc.1", COMMIT.replace(/e/g, "x")]) {
    assert.equal(sourceDocument({ version: "27.1-rc.1", repository: REPOSITORY, revision }), null, String(revision));
  }
});

test("served at the root, public and uncached", async (t) => {
  const was = config.revision;
  t.after(() => {
    config.revision = was;
  });
  config.revision = COMMIT;
  for (const basePath of ["", "/mail"]) {
    const res = await createApp(basePath).request("/.well-known/source");
    assert.equal(res.status, 200, basePath);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "no-cache");
    const doc = (await res.json()) as { software: Array<{ revision: string; repository: string }> };
    assert.equal(doc.software[0].revision, COMMIT);
    assert.equal(doc.software[0].repository, config.sourceUrl);
  }
});

test("a build without its commit answers 404, not the app", async (t) => {
  const was = config.revision;
  t.after(() => {
    config.revision = was;
  });
  config.revision = null;
  const res = await createApp("").request("/.well-known/source");
  assert.equal(res.status, 404);
});
