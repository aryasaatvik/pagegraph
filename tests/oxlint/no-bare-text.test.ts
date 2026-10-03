import { runRuleTests } from "./run-rule-tests";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "node/no-bare-text.node.test.js");

describe("no-bare-text oxlint rule", () => {
  it("passes its Node RuleTester cases", () => {
    const result = runRuleTests(fixture);
    expect(result.error?.message).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
