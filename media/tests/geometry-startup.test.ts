import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "../scripts/geometry";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "pagegraph-media-startup-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

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
