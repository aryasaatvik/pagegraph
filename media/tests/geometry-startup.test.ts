import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, openBrowser } from "../scripts/geometry";

describe("Chrome discovery", () => {
  const system = async () => "/usr/bin/google-chrome";

  test("falls back to system Chrome when the HyperFrames cache does not exist", async () => {
    const cache = join(scratch, "no-cache");
    expect(await findChrome({ env: {}, cache, system })).toBe("/usr/bin/google-chrome");
  });

  test("prefers the HyperFrames-managed Chrome, and CHROME_PATH over both", async () => {
    const cache = join(scratch, "cache");
    const managed = join(cache, "chrome-headless-shell/linux-1/chrome-headless-shell-linux64");
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, "chrome-headless-shell"), "");
    expect(await findChrome({ env: {}, cache, system })).toBe(
      join(managed, "chrome-headless-shell"),
    );
    expect(await findChrome({ env: { CHROME_PATH: "/opt/chrome" }, cache, system })).toBe(
      "/opt/chrome",
    );
  });

  test("names the fix when no Chrome is installed", async () => {
    const cache = join(scratch, "no-cache");
    await expect(findChrome({ env: {}, cache, system: async () => undefined })).rejects.toThrow(
      "run `bunx hyperframes browser ensure` or set CHROME_PATH",
    );
  });
});

/**
 * A Chrome that is missing, exits, or never opens DevTools fails `openBrowser` within its deadline
 * and leaves no profile directory or process behind. The browser profile is created under `TMPDIR`,
 * pointed here at an empty directory, and `CHROME_PATH` at a stand-in.
 */
let scratch: string;
let profiles: string;
const saved = { TMPDIR: process.env.TMPDIR, CHROME_PATH: process.env.CHROME_PATH };
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "pagegraph-media-startup-"));
  profiles = join(scratch, "tmp");
  await mkdir(profiles);
  process.env.TMPDIR = profiles;
});
afterEach(async () => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await rm(scratch, { recursive: true, force: true });
});

async function standIn(script: string): Promise<string> {
  const path = join(scratch, "chrome");
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("browser startup failure", () => {
  test("a CHROME_PATH that does not exist rejects and cleans up", async () => {
    process.env.CHROME_PATH = join(scratch, "missing-chrome");
    await expect(openBrowser()).rejects.toThrow();
    expect(await readdir(profiles)).toEqual([]);
  });

  test("a Chrome that exits before DevTools rejects and cleans up", async () => {
    process.env.CHROME_PATH = await standIn('echo "no display" >&2\nexit 1');
    await expect(openBrowser()).rejects.toThrow(/exited before DevTools was ready:\nno display/);
    expect(await readdir(profiles)).toEqual([]);
  });

  test("a Chrome that never opens DevTools times out, is stopped, and cleans up", async () => {
    const pidFile = join(scratch, "pid");
    process.env.CHROME_PATH = await standIn(`echo $$ > "${pidFile}"\nexec sleep 600`);
    const started = performance.now();
    await expect(openBrowser({ startupTimeout: 500 })).rejects.toThrow(
      "Chrome's DevTools endpoint did not open within 0.5s",
    );
    expect(performance.now() - started).toBeLessThan(5_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readdir(profiles)).toEqual([]);
  }, 10_000);
});
