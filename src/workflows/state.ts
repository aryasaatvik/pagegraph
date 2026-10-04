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

export const ActionState = Schema.Struct({
  summary: Schema.String,
  files: Schema.Array(Schema.String),
  outcome: Schema.Literals(["applied", "dry-run", "no-change"]),
});
export const decodeActionState = Schema.decodeUnknownSync(ActionState);
const actionDocument = Schema.toJsonSchemaDocument(ActionState);
export const actionStateJsonSchema = { ...actionDocument.schema, $defs: actionDocument.definitions };
