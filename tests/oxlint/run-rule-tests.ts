import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Bun's --bun prepends a node shim; RuleTester requires the actual Node runtime. */
export function runRuleTests(fixture: string) {
  const bun = realpathSync(process.execPath);
  const node = (process.env.PATH ?? "").split(delimiter)
    .map((directory) => join(directory, process.platform === "win32" ? "node.exe" : "node"))
    .find((candidate) => existsSync(candidate) && realpathSync(candidate) !== bun);
  if (node === undefined) throw new Error("oxlint rule tests require Node >=22 on PATH");
  return spawnSync(node, ["--test", fixture], { encoding: "utf8" });
}
