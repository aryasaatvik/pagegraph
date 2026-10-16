import type { TegamiPlugin } from "tegami";

export const releaseChecks = (): TegamiPlugin => ({
  name: "pagegraph-release-checks",
  enforce: "pre",
  async afterPreflight({ plan }) {
    if (plan.packages.get("npm:pagegraph")?.preflight?.shouldPublish !== true) return;

    const child = Bun.spawn(["bun", "run", "release:check"], {
      cwd: this.cwd,
      stderr: "inherit",
      stdout: "inherit",
    });
    if ((await child.exited) !== 0) throw new Error("Pagegraph release gate failed");
  },
});
