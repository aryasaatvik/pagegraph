import { join, resolve } from "node:path";

export const app = resolve(import.meta.dir, "..");
export const repository = resolve(app, "..");
export const launchDir = join(app, "launches/introducing-pagegraph");
export const exportsDir = join(app, "exports");
export const stillDir = (file: string) => join(app, ".build/stills", file.replace(/\.png$/, ""));
export const hyperframes = join(app, "node_modules/.bin/hyperframes");

/** HyperFrames sends anonymous usage telemetry unless told not to. */
const quiet = { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };

/** Run a command to completion, inheriting output; throw on a nonzero exit. */
export async function run(command: ReadonlyArray<string>): Promise<void> {
  const child = Bun.spawn([...command], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...quiet },
  });
  if ((await child.exited) !== 0) throw new Error(`failed: ${command.join(" ")}`);
}
