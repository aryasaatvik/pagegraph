import { relative, resolve, sep } from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { parseSync, Visitor } from "oxc-parser";
import type { JSXOpeningElement, Program } from "oxc-parser";

class DocumentSourceError extends Schema.TaggedError<DocumentSourceError>()("DocumentSourceError", {
  message: Schema.String,
}) {}

const SOURCE_COMPONENTS = new Set(["T", "Title", "Section", "Visual", "ForAgents", "ForHumans"]);

const parse = Effect.fn("DocumentSource.parse")(function* (code: string, id: string) {
  const parsed = parseSync(id, code);
  if (parsed.errors.length)
    return yield* new DocumentSourceError({
      message: `Cannot parse document source ${id}: ${parsed.errors.map((error) => error.message).join("; ")}`,
    });
  return parsed.program;
});

function componentNames(program: Program): {
  named: Set<string>;
  sections: Set<string>;
  namespaces: Set<string>;
} {
  const named = new Set<string>();
  const sections = new Set<string>();
  const namespaces = new Set<string>();
  for (const node of program.body) {
    if (
      node.type !== "ImportDeclaration" ||
      node.source.value !== "pagegraph/react" ||
      node.importKind === "type"
    )
      continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === "ImportSpecifier") {
        if (specifier.importKind === "type") continue;
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        if (SOURCE_COMPONENTS.has(imported)) named.add(specifier.local.name);
        if (imported === "Section") sections.add(specifier.local.name);
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(specifier.local.name);
      }
    }
  }
  return { named, sections, namespaces };
}

function memberParts(name: JSXOpeningElement["name"]): Array<string> {
  if (name.type === "JSXIdentifier") return [name.name];
  if (name.type !== "JSXMemberExpression") return [];
  return [...memberParts(name.object), name.property.name];
}

function isSourceComponent(
  name: JSXOpeningElement["name"],
  names: ReturnType<typeof componentNames>,
): boolean {
  const parts = memberParts(name);
  const [base, ...members] = parts;
  if (base === undefined) return false;
  if (members.length === 0) return names.named.has(base);
  if (names.namespaces.has(base))
    return (
      (members.length === 1 && members[0] !== undefined && SOURCE_COMPONENTS.has(members[0])) ||
      (members.length === 2 && members[0] === "Section" && members[1] === "Item")
    );
  return names.sections.has(base) && members.length === 1 && members[0] === "Item";
}

/** Record authored JSX source locations without changing router imports. */
export function transformDocumentSource(
  code: string,
  id: string,
  root: string,
): { code: string } | undefined {
  // oxlint-disable-next-line eslint/no-restricted-properties -- Vite's document transform exposes a synchronous source API.
  const program = Effect.runSync(parse(code, id));
  const names = componentNames(program);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const file = relative(resolve(root), resolve(id)).split(sep).join("/");

  new Visitor({
    JSXOpeningElement(node) {
      if (!isSourceComponent(node.name, names)) return;
      if (
        node.attributes.some(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.type === "JSXIdentifier" &&
            attribute.name.name === "source",
        )
      )
        return;
      const line = code.slice(0, node.start).split("\n").length;
      edits.push({
        start: node.name.end,
        end: node.name.end,
        value: ` source=${JSON.stringify(`${file}:${line}`)}`,
      });
    },
  }).visit(program);

  if (edits.length === 0) return undefined;
  edits.sort((a, b) => b.start - a.start);
  let transformed = code;
  for (const edit of edits)
    transformed = transformed.slice(0, edit.start) + edit.value + transformed.slice(edit.end);
  return { code: transformed };
}
