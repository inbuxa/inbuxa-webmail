import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { failureReason } from "./upstream.js";

/**
 * A sign-in that can't reach the mail server used to log only "fetch failed",
 * with nothing in the proxy's or the server's logs to explain it. The reason
 * Node had (refused, unknown host, untrusted certificate) was on `cause`.
 */

test("a refused connection says so", async () => {
  // A port that was just free, so nothing is listening on it.
  const port = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
  const err = await fetch(`http://127.0.0.1:${port}/`).then(() => null, (e: unknown) => e);
  assert.ok(err);
  assert.match(failureReason(err), /^fetch failed \(.*ECONNREFUSED/);
});

test("the code is added when the cause's message lacks it", () => {
  const cause = Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  assert.equal(
    failureReason(new TypeError("fetch failed", { cause })),
    "fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate)",
  );
});

test("several failed addresses report the first", () => {
  const first = Object.assign(new Error("connect ECONNREFUSED ::1:443"), { code: "ECONNREFUSED" });
  const cause = new AggregateError([first, new Error("connect ECONNREFUSED 127.0.0.1:443")]);
  assert.equal(failureReason(new TypeError("fetch failed", { cause })), "fetch failed (connect ECONNREFUSED ::1:443)");
});

test("an error without a cause is unchanged", () => {
  assert.equal(failureReason(new Error("OAuth metadata request failed (502)")), "OAuth metadata request failed (502)");
  assert.equal(failureReason("odd"), "odd");
});
