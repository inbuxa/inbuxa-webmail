import { readFileSync } from "node:fs";

/*
 * inbuxa K-W4: a secret from the environment, or from the file `<NAME>_FILE`
 * names -- a mounted Kubernetes or Docker secret, so the value never sits in
 * the process environment where `docker inspect` or a crash dump shows it.
 * The server reads its own secrets the same way (`INBUXA_<NAME>_FILE`).
 *
 * One trailing newline is dropped, since `echo` and most editors add one.
 * Setting both, or naming a file that can't be read or is empty, is refused:
 * a webmail that quietly started with no secret, or the wrong one, would sign
 * everyone out or fail every sign-in. Errors name the variable and the path,
 * never the value.
 */
export function secretEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string {
  const value = env[name] ?? "";
  const file = env[`${name}_FILE`] ?? "";
  if (!file) return value;
  if (value) throw new Error(`${name} and ${name}_FILE are both set: use one`);
  let contents: string;
  try {
    contents = read(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Error(`${name}_FILE: can't read ${file} (${code})`);
  }
  const secret = contents.replace(/\r?\n$/, "");
  if (!secret) throw new Error(`${name}_FILE: ${file} is empty`);
  return secret;
}
