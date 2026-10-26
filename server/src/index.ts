import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createApp, sessions } from "./app.js";

async function main() {
  await sessions.init();
  const app = createApp();
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    const address = info.address.includes(":") ? `[${info.address}]` : info.address;
    console.log(`[ihasmail] ${config.appName} listening on http://${address}:${info.port}`);
    console.log(`[ihasmail] mail server: ${config.stalwartUrl}`);
    console.log(`[ihasmail] static dir: ${config.staticDir}`);
  });
  // `::` is the default, and a kernel booted without IPv6 cannot open it at
  // all. Listening on IPv4 alone is still a working server; refusing to start
  // over an address family nobody asked for is not.
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (config.host === "::" && err.code === "EAFNOSUPPORT") {
      console.log("[ihasmail] no IPv6 on this host, listening on IPv4 only");
      server.listen(config.port, "0.0.0.0");
      return;
    }
    console.error("[ihasmail] fatal:", err);
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    console.log(`[ihasmail] ${signal} received, shutting down`);
    server.close();
    await sessions.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[ihasmail] fatal:", err);
  process.exit(1);
});
