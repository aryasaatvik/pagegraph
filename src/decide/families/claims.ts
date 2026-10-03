import * as Schema from "effect/Schema";
import type * as Decision from "effect/ai/Decision";

import { globToRegExp } from "../../core/checks";
import type { PageHead } from "../../core/page-heads";
import { hashDocument, type Message, type PageDocument, type SectionDocument } from "../../markdown/document";
import type { Facts } from "../../markdown/facts";
import { sectionMarkdown } from "../../markdown/markdown";
import type { DecisionFamily } from "../run";

const FactDefinition = Schema.Struct({
  kind: Schema.Literals(["number", "money", "list", "text"]),
  value: Schema.Json,
  text: Schema.String,
  items: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Authored prose, code-owned facts, and evidence supplied to adopter rules. */
export const claimsInput = Schema.Struct({
  path: Schema.String,
  evidence: Schema.optionalKey(Schema.String),
  section: Schema.Struct({
    id: Schema.String,
    kind: Schema.String,
    markdown: Schema.String,
    messages: Schema.Array(Schema.Struct({
      hash: Schema.String, text: Schema.String, facts: Schema.Array(Schema.String),
    })),
  }),
  facts: Schema.Record(Schema.String, FactDefinition),
  context: Schema.optionalKey(Schema.String),
});
export type ClaimsInput = typeof claimsInput.Type;
export type ClaimsRules = Decision.Definition<typeof claimsInput, Record<string, Decision.Probability>>;
export interface ClaimsOptions {
  readonly rules: ClaimsRules;
  readonly model: string;
  readonly cutoff?: number;
  readonly context?: string;
  /** Exclude metadata by path glob; captured sections remain in the gate. */
  readonly excludeHeads?: ReadonlyArray<string>;
}
export type ClaimsVerdict = "pass" | "violation";
const ClaimsAnswers = Schema.Record(Schema.String, Schema.Struct({ probability: Schema.Finite }));

/** Claims use a single upper cutoff; probabilities below it pass without a review band. */
export function claimsFamily(rules: ClaimsRules): DecisionFamily<ClaimsInput> {
  if (Object.keys(rules.decisions).length === 0) throw new Error("Claims need at least one decision rule");
  if (Object.values(rules.decisions).some((rule) => rule._tag !== "Probability"))
    throw new Error("Claims rules must be probability decisions");
  return {
    name: "claims",
    input: claimsInput,
    definitionFor: () => rules,
    inputRef: (input) => `${input.path} › ${input.section.id}`,
    evaluate: (_input, answers, cutoff): ClaimsVerdict =>
      Object.values(Schema.decodeUnknownSync(ClaimsAnswers)(answers))
        .some((answer) => answer.probability >= cutoff) ? "violation" : "pass",
  };
}

/** Heads describe only pages outside capture; duplicate ownership fails before evaluation. */
export function resolveClaimsDocuments(
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  excludeHeads: ReadonlyArray<string> = [],
): ReadonlyArray<PageDocument> {
  const paths = new Set<string>();
  for (const document of documents) {
    if (paths.has(document.path)) throw new Error(`Duplicate claims page path "${document.path}"`);
    paths.add(document.path);
  }
  const seenHeads = new Set<string>();
  const excludes = excludeHeads.map(globToRegExp);
  const extra: Array<PageDocument> = [];
  for (const head of heads) {
    if (seenHeads.has(head.path)) throw new Error(`Duplicate claims head path "${head.path}"`);
    seenHeads.add(head.path);
    if (paths.has(head.path)) throw new Error(`Duplicate claims page path "${head.path}"`);
    if (excludes.some((pattern) => pattern.test(head.path))) continue;
    const document = { ...head, sections: [], messages: [], facts: [] };
    extra.push({ ...document, hash: hashDocument(document) });
  }
  return [...documents, ...extra];
}
function sectionMessages(section: SectionDocument): ReadonlyArray<Message> {
  return [
    ...(section.title === undefined ? [] : [section.title]),
    ...section.body.flatMap((entry) => entry.type === "message" ? [entry.message] : []),
    ...section.items.flatMap((item) => [
      ...(item.title === undefined ? [] : [item.title]),
      ...item.body.flatMap((entry) => entry.type === "message" ? [entry.message] : []),
      ...item.cells,
    ]),
  ];
}

/** Source locations do not enter model input or answer identity. */
export function claimsInputs(
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  facts: Facts,
  options: Pick<ClaimsOptions, "context" | "excludeHeads"> = {},
): ReadonlyArray<ClaimsInput> {
  const excludes = (options.excludeHeads ?? []).map(globToRegExp);
  return resolveClaimsDocuments(documents, heads, options.excludeHeads).flatMap((document) => {
    const sections: ReadonlyArray<SectionDocument> = [
      ...document.sections,
      ...(excludes.some((pattern) => pattern.test(document.path)) ? [] : [{
        id: "head", kind: "head", claimsMarkdown: `${document.title}\n\n${document.description}`,
        body: [], items: [], source: document.path, audience: "all" as const,
      }]),
    ];
    return sections.map((section) => {
      const evidence = document.sections.filter((entry) => entry.evidence === true && entry !== section)
        .map((entry) => entry.claimsMarkdown ?? sectionMarkdown(entry, { includeHumans: true })).join("\n\n");
      return Schema.decodeUnknownSync(claimsInput)({
        path: document.path,
        ...(evidence === "" ? {} : { evidence }),
        section: {
          id: section.id, kind: section.kind,
          markdown: section.claimsMarkdown ?? sectionMarkdown(section, { includeHumans: true }),
          messages: sectionMessages(section).map(({ hash, text, facts }) => ({ hash, text, facts })),
        },
        facts,
        ...(options.context === undefined ? {} : { context: options.context }),
      });
    });
  });
}
