export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json };
export interface FactDefinition {
  readonly kind: "number" | "money" | "list" | "text";
  readonly value: Json;
  readonly text: string;
  readonly items?: ReadonlyArray<string>;
}
export type Facts = Readonly<Record<string, FactDefinition>>;
const registeredFacts = new Map<string, FactDefinition>();

function isJson(value: unknown, parents = new Set<object>()): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || parents.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) return false;
  parents.add(value);
  const entries = Array.isArray(value) ? Array.from(value) : Object.values(value);
  const valid = entries.every((entry) => isJson(entry, parents));
  parents.delete(value);
  return valid;
}
function validateDefinition(value: unknown): FactDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected object");
  for (const key of ["kind", "value", "text"]) {
    if (!(key in value)) throw new Error(`Missing key\n  at ["${key}"]`);
  }
  if (!("kind" in value) || !["number", "money", "list", "text"].includes(String(value.kind)))
    throw new Error('Expected "number" | "money" | "list" | "text"\n  at ["kind"]');
  if (!("value" in value) || !isJson(value.value)) throw new Error('Expected JSON value\n  at ["value"]');
  if (!("text" in value) || typeof value.text !== "string") throw new Error('Expected string\n  at ["text"]');
  let items: Array<string> | undefined;
  if ("items" in value) {
    if (!Array.isArray(value.items)) throw new Error('Expected array\n  at ["items"]');
    items = Array.from(value.items, (item, index) => {
      if (typeof item !== "string") throw new Error(`Expected string\n  at ["items"][${index}]`);
      return item;
    });
  }
  const kind = value.kind;
  if (kind !== "number" && kind !== "money" && kind !== "list" && kind !== "text")
    throw new Error('Expected "number" | "money" | "list" | "text"\n  at ["kind"]');
  return { kind, value: value.value, text: value.text, ...(items === undefined ? {} : { items }) };
}

/** Register code-owned values for ordinary React rendering as well as capture. */
export function defineFacts<const F extends Facts>(facts: F): F {
  for (const [id, definition] of Object.entries(facts)) {
    if (!id) throw new Error("A copy fact needs a nonempty id");
    registeredFacts.set(id, validateDefinition(definition));
  }
  return facts;
}
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Copy fact must be finite: ${value}`);
  return value;
}
export const fact = {
  number(value: number, options?: Intl.NumberFormatOptions): FactDefinition {
    const validated = finite(value);
    return { kind: "number", value: validated, text: new Intl.NumberFormat("en-US", options).format(validated) };
  },
  money(value: number, options: { currency?: string; per?: string } = {}): FactDefinition {
    const validated = finite(value);
    const text = new Intl.NumberFormat("en-US", {
      style: "currency", currency: options.currency ?? "USD",
    }).format(validated);
    return { kind: "money", value: validated, text: options.per === undefined ? text : `${text} per ${options.per}` };
  },
  list<T extends Json>(values: ReadonlyArray<T>, options?: { format: (value: T) => string }): FactDefinition {
    const items = values.map((value) => options === undefined ? String(value) : options.format(value));
    return { kind: "list", value: [...values], items, text: new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(items) };
  },
  text(value: string): FactDefinition { return { kind: "text", value, text: value }; },
};
export function resolveFact(id: string, facts?: Facts): FactDefinition {
  const value = facts === undefined ? registeredFacts.get(id) : facts[id];
  if (value === undefined) throw new Error(`Unknown copy fact "${id}"; register it with defineFacts`);
  return value;
}
