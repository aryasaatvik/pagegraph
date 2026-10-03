import { createServer, preview } from "vite";

const options = {
  root: import.meta.dirname,
  configFile: `${import.meta.dirname}/vite.config.ts`,
  logLevel: "error",
};
const server = process.argv[2] === "dev"
  ? await createServer({ ...options, server: { port: 0, host: "127.0.0.1" } })
  : await preview({ ...options, preview: { port: 0, host: "127.0.0.1" } });
if (process.argv[2] === "dev") await server.listen();
const origin = server.resolvedUrls?.local[0];
if (origin === undefined) throw new Error("Fixture server did not expose its origin");
console.log(`PAGEGRAPH_FIXTURE_ORIGIN=${origin}`);
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
