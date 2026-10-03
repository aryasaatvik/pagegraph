export interface WorkflowMutationPolicyOptions {
  /** The repository state captured immediately before the workflow starts. */
  readonly dirtyAtStart: boolean;
  /** Permit a mutating workflow to start with pre-existing local changes. */
  readonly allowDirty?: boolean | undefined;
  /** Run without repository mutation tools. Executor remains available. */
  readonly dryRun?: boolean | undefined;
}

export interface WorkflowMutationPolicy {
  readonly mode: "write" | "dry-run";
  readonly dirtyAtStart: boolean;
  readonly allowDirty: boolean;
  readonly assertStartAllowed: () => void;
}

export const createWorkflowMutationPolicy = (
  options: WorkflowMutationPolicyOptions,
): WorkflowMutationPolicy => {
  const allowDirty = options.allowDirty === true;
  const dryRun = options.dryRun === true;

  return {
    mode: dryRun ? "dry-run" : "write",
    dirtyAtStart: options.dirtyAtStart,
    allowDirty,
    assertStartAllowed: () => {
      if (options.dirtyAtStart && !allowDirty && !dryRun) {
        throw new Error(
          "Workflow refuses to run on a dirty Git tree; pass --allow-dirty for writes or --dry-run for read-only execution.",
        );
      }
    },
  };
};
