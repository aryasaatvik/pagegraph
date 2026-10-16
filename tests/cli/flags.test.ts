import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));

describe("CLI boolean flags", () => {
  it("uses false for omitted audit switches", () => {
    const result = spawnSync("bun", [cli, "audit", "https://127.0.0.1", "--probe-only", "--json"], {
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.stderr).not.toContain("Missing required flag");
    expect(JSON.parse(result.stdout)).toMatchObject({
      targets: ["https://127.0.0.1/"],
      results: [
        {
          scanner: "http",
          error: "Every HTTP probe failed: Private target is not allowed: 127.0.0.1",
        },
      ],
    });
  }, 15_000);
});
