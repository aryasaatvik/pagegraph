import { describe, expect, it } from "vitest";
import { defineFacts, fact, resolveFact } from "../../src/markdown/facts";

describe("fact boundary validation", () => {
  it("retains builders, registration, explicit fact scopes, and original diagnostics", () => {
    const facts = defineFacts({
      revenue: fact.money(1234, { per: "month" }),
      channels: fact.list(["email", "SMS"]),
      greeting: fact.text("Hello"),
    });
    expect(resolveFact("revenue").text).toBe("$1,234.00 per month");
    expect(resolveFact("channels", facts).text).toBe("email and SMS");
    expect(resolveFact("greeting", facts)).toEqual({ kind: "text", value: "Hello", text: "Hello" });
    expect(() => resolveFact("revenue", {})).toThrow('Unknown copy fact "revenue"; register it with defineFacts');
    expect(() => defineFacts({ "": fact.text("invalid") })).toThrow("A copy fact needs a nonempty id");
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => fact.number(value)).toThrow(`Copy fact must be finite: ${value}`);
      expect(() => fact.money(value)).toThrow(`Copy fact must be finite: ${value}`);
    }
  });
  it("rejects non-JSON values even when supplied through untyped input", () => {
    for (const value of [undefined, NaN, new Date(), Object.create({ inherited: true }), new Array(1)]) {
      // Reflect exercises the public runtime boundary with inputs TypeScript forbids.
      expect(() => Reflect.apply(defineFacts, undefined, [{ invalid: { kind: "text", value, text: "x" } }]))
        .toThrow('Expected JSON value\n  at ["value"]');
    }
  });
  it.each([
    [null, "Expected object"],
    [{}, 'Missing key\n  at ["kind"]'],
    [{ kind: "other", value: 1, text: "x" }, 'Expected "number" | "money" | "list" | "text"\n  at ["kind"]'],
    [{ kind: "text", value: 1, text: 1 }, 'Expected string\n  at ["text"]'],
    [{ kind: "text", value: 1, text: "x", items: "x" }, 'Expected array\n  at ["items"]'],
    [{ kind: "text", value: 1, text: "x", items: new Array(1) }, 'Expected string\n  at ["items"][0]'],
    [{ kind: "text", value: 1, text: "x", items: [1] }, 'Expected string\n  at ["items"][0]'],
  ])("preserves schema diagnostic for %j", (definition, message) => {
    expect(() => Reflect.apply(defineFacts, undefined, [{ invalid: definition }])).toThrow(message);
  });
});
