#!/usr/bin/env node
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "installations"), `${process.cwd()}\n`);
const config = process.argv.find((argument) => argument.startsWith("--config="));
if (process.argv[2] !== "install" || !config || realpathSync(config.slice("--config=".length)) !== realpathSync(join(process.cwd(), "bunfig.toml"))) {
  throw new Error("The installer must use its own config.");
}
if (process.env.npm_config_registry || process.env.BUN_CONFIG_VERBOSE_FETCH) {
  throw new Error("Consumer package-manager settings reached the isolated installer.");
}
const file = (path, content) => {
  const target = join(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};
for (const name of ["sdk", "core", "plugin", "server", "util"]) {
  file(`node_modules/@opencode/${name}/package.json`, JSON.stringify({
    name: `@opencode/${name}`, version: "2.0.22", dependencies: { "drizzle-orm": "1.0.0-rc.5-169397b" },
  }));
}
file("node_modules/effect/package.json", JSON.stringify({ name: "effect", version: "4.0.0-rc.112" }));
file("node_modules/@effect/platform-node-shared/package.json", JSON.stringify({ version: "4.0.0-rc.112" }));
file("node_modules/drizzle-orm/package.json", JSON.stringify({ name: "drizzle-orm", version: "1.0.0-rc.5-169397b" }));
file("node_modules/@opencode/sdk/dist/index.js", "export const OpenCode = { create() {} };\n");
file("node_modules/@opencode/client/dist/chunks/service-contender-50fct660.js", `
class ClientError3 extends Error {
  constructor(reason, options) { super(reason, options); this.reason = reason; }
}
const declared = (body) => Object.assign(new Error(body.message), { body });
const json = (response) => response.json();
export const makeResponseError = () => {
  const responseError = async (response, descriptor) => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared(await json(response));
    try {
      await response.body?.cancel();
    } catch {}
    throw new ClientError3("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) });
  };
  return responseError;
};
`);
