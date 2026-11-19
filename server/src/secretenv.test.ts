import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretEnv } from "./secretenv.js";

const never = () => {
  throw new Error("read when it shouldn't be");
};

test("a secret from the environment, as before", () => {
  assert.equal(secretEnv("APP_SECRET", { APP_SECRET: "from-env" }, never), "from-env");
  assert.equal(secretEnv("APP_SECRET", {}, never), "");
});

test("a secret from a file, one trailing newline dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "webmail-secret-"));
  try {
    const path = join(dir, "app-secret");
    writeFileSync(path, "from-file\n");
    assert.equal(secretEnv("APP_SECRET", { APP_SECRET_FILE: path }), "from-file");
    writeFileSync(path, "crlf\r\n");
    assert.equal(secretEnv("APP_SECRET", { APP_SECRET_FILE: path }), "crlf");
    writeFileSync(path, "  kept as is  ");
    assert.equal(secretEnv("APP_SECRET", { APP_SECRET_FILE: path }), "  kept as is  ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both set is refused, without the value in the message", () => {
  assert.throws(
    () => secretEnv("OAUTH_CLIENT_SECRET", { OAUTH_CLIENT_SECRET: "s3cret-value", OAUTH_CLIENT_SECRET_FILE: "/run/x" }, never),
    (err: Error) => /both set/.test(err.message) && !err.message.includes("s3cret-value"),
  );
});

test("a missing or empty file is refused, naming the variable and path", () => {
  assert.throws(
    () => secretEnv("APP_SECRET", { APP_SECRET_FILE: "/nonexistent/app-secret" }),
    /APP_SECRET_FILE: can't read \/nonexistent\/app-secret \(ENOENT\)/,
  );
  assert.throws(() => secretEnv("APP_SECRET", { APP_SECRET_FILE: "/run/s" }, () => "\n"), /APP_SECRET_FILE: \/run\/s is empty/);
});
