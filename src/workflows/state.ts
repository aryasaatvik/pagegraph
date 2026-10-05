import { Schema } from "effect";
import type { AnyWorkflowSpec } from "./specs/types";

export const dropNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(dropNulls);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null)
      .map(([key, item]) => [key, dropNulls(item)]));
  }
  return value;
};

const capState = (state: unknown, limit: number): unknown => {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  if (Array.isArray(record["opportunities"])) {
    return { ...record, opportunities: record["opportunities"].slice(0, limit) };
  }
  if (Array.isArray(record["items"])) return { ...record, items: record["items"].slice(0, limit) };
  return state;
};

export const normalizeResearchState = (value: unknown, limit: number): unknown => capState(dropNulls(value), limit);

export const decodeResearchState = (spec: AnyWorkflowSpec, value: unknown, limit: number): unknown => {
  const decoded = spec.decodeState(normalizeResearchState(value, limit));
  const issues: Array<string> = [];
  for (const [index, item] of spec.decisionInputs(decoded).entries()) {
    try {
      const error = spec.validateDecisionInput(item);
      if (error !== undefined) issues.push(`decisionInputs[${index}]: ${error}`);
    } catch (cause) {
      issues.push(`decisionInputs[${index}]: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (issues.length > 0) throw new Error(issues.join("\n"));
  return decoded;
};

/** Recover independently valid recommendations while retaining their original item indexes. */
export const salvageResearchState = (spec: AnyWorkflowSpec, value: unknown, limit: number): {
  readonly state: unknown;
  readonly rejectedItems: ReadonlyArray<{ readonly index: number; readonly reason: string }>;
} => {
  const normalized = normalizeResearchState(value, limit);
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("Workflow result must contain a valid summary and an items or opportunities array.");
  }
  const record = normalized as Record<string, unknown>;
  const key = Array.isArray(record["opportunities"]) ? "opportunities" : "items";
  const items = record[key];
  if (!Array.isArray(items)) throw new Error(`Workflow result requires an ${key} array.`);
  const sourceItems = (value as Record<string, unknown>)[key];
  const sourceIndexes = Array.isArray(sourceItems)
    ? sourceItems.flatMap((item, index) => item === null ? [] : [index]).slice(0, limit) : [];
  // Invalid envelope fields cannot be repaired by dropping recommendations.
  decodeResearchState(spec, { ...record, [key]: [] }, limit);
  const valid: unknown[] = [];
  const rejectedItems: Array<{ readonly index: number; readonly reason: string }> = [];
  for (const [position, item] of items.entries()) {
    const index = sourceIndexes[position] ?? position;
    try {
      decodeResearchState(spec, { ...record, [key]: [item] }, limit);
      valid.push(item);
    } catch (cause) {
      rejectedItems.push({ index, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  if (valid.length === 0) throw new Error(rejectedItems.map(({ index, reason }) => `${key}[${index}]: ${reason}`).join("\n") || "No valid workflow items were submitted.");
  return { state: decodeResearchState(spec, { ...record, [key]: valid }, limit), rejectedItems };
};

export const ActionState = Schema.Struct({
  summary: Schema.String,
  files: Schema.Array(Schema.String),
  outcome: Schema.Literals(["applied", "dry-run", "no-change"]),
});
export const decodeActionState = Schema.decodeUnknownSync(ActionState);
const actionDocument = Schema.toJsonSchemaDocument(ActionState);
export const actionStateJsonSchema = { ...actionDocument.schema, $defs: actionDocument.definitions };
