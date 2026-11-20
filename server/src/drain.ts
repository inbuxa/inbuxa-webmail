/*
 * Shutting down without anyone noticing (K-W5): on SIGTERM the server
 * drains instead of exiting on the spot.
 *
 *   1. draining: /api/health answers 503, and every response says
 *      `Connection: close`, so load balancers and keep-alive clients move to
 *      another replica. Requests are still served.
 *   2. after SHUTDOWN_DELAY (default 3 s, the time a load balancer takes to
 *      notice), no new connections, and every live-update stream is ended
 *      cleanly: each tab's EventSource reconnects, through the load
 *      balancer, to a replica that's staying.
 *   3. requests already in flight finish, for up to SHUTDOWN_TIMEOUT
 *      (default 5 s); whatever is left is closed, and the process exits.
 *
 * The defaults fit inside both `docker stop` (10 s) and Kubernetes' default
 * grace period (30 s).
 */
import type { Server } from "node:http";

let draining = false;
const closers = new Set<() => void>();

/** True from SIGTERM on. */
export function isDraining(): boolean {
  return draining;
}

/**
 * Runs `close` when the streams are ended (step 2), or at once if they
 * already have been. Returns the call that takes it off the list, for a
 * stream that ends first.
 */
export function onStreamsEnd(close: () => void): () => void {
  if (streamsEnded) {
    queueMicrotask(close);
    return () => {};
  }
  closers.add(close);
  return () => { closers.delete(close); };
}

let streamsEnded = false;

/** Step 2's stream half: every registered stream ends. Exported for tests. */
export function endStreams(): number {
  streamsEnded = true;
  const all = [...closers];
  closers.clear();
  for (const close of all) {
    try { close(); } catch { /* one stream's trouble isn't the others' */ }
  }
  return all.length;
}

/** For tests: back to serving. */
export function resetDrain(): void {
  draining = false;
  streamsEnded = false;
  closers.clear();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The whole sequence; resolves once the server has stopped. */
export async function drain(server: Server, delayMs: number, timeoutMs: number, log: (msg: string) => void): Promise<void> {
  draining = true;
  log(`draining: ${delayMs} ms for load balancers to move on`);
  if (delayMs > 0) await sleep(delayMs);

  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const streams = endStreams();
  server.closeIdleConnections();
  log(`no new connections; ${streams} live-update stream(s) ended`);

  // A connection a request just finished on goes idle, and would hold the
  // server open (keep-alive) until the timeout: close those as they come
  const sweep = setInterval(() => server.closeIdleConnections(), 100);
  const finished = await Promise.race([closed.then(() => true), sleep(timeoutMs).then(() => false)]);
  clearInterval(sweep);
  if (!finished) {
    log(`requests still open after ${timeoutMs} ms: closing them`);
    server.closeAllConnections();
  }
}
