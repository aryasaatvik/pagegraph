import { describe, expect, it } from "vitest";

import {
  createWorkflowMutationPolicy,
} from "../../src/workflows/mutation";

describe("workflow mutation policy", () => {
  it("allows clean workflows to write by default", () => {
    const policy = createWorkflowMutationPolicy({
      dirtyAtStart: false,
    });

    expect(policy.mode).toBe("write");
    expect(() => policy.assertStartAllowed()).not.toThrow();
  });

  it("refuses dirty mutating workflows unless explicitly allowed", () => {
    const policy = createWorkflowMutationPolicy({
      dirtyAtStart: true,
    });

    expect(() => policy.assertStartAllowed()).toThrow(/dirty Git tree/);
  });

  it("allows an explicitly dirty mutating workflow", () => {
    const policy = createWorkflowMutationPolicy({
      dirtyAtStart: true,
      allowDirty: true,
    });

    expect(policy.mode).toBe("write");
    expect(() => policy.assertStartAllowed()).not.toThrow();
  });

  it("allows dirty dry runs", () => {
    const policy = createWorkflowMutationPolicy({
      dirtyAtStart: true,
      dryRun: true,
    });

    expect(policy.mode).toBe("dry-run");
    expect(() => policy.assertStartAllowed()).not.toThrow();

  });
});
