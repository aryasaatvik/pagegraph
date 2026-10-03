const INLINE_TAGS = new Set(["em", "strong", "a", "code", "br"]);

function importedTNames(program) {
  const named = new Set();
  const facts = new Set();
  const namespaces = new Set();
  for (const declaration of program.body) {
    if (
      declaration.type !== "ImportDeclaration" ||
      declaration.source.value !== "pagegraph/react" ||
      declaration.importKind === "type"
    )
      continue;
    for (const specifier of declaration.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
        const imported = specifier.imported.name ?? specifier.imported.value;
        if (imported === "T" || imported === "Title") named.add(specifier.local.name);
        if (imported === "Fact") facts.add(specifier.local.name);
      } else if (specifier.type === "ImportNamespaceSpecifier")
        namespaces.add(specifier.local.name);
    }
  }
  return { named, facts, namespaces };
}

function parts(node) {
  if (node.type === "JSXIdentifier") return [node.name];
  if (node.type === "JSXMemberExpression") return [...parts(node.object), node.property.name];
  return [];
}

function isT(node, names) {
  const path = parts(node);
  return (
    (path.length === 1 && names.named.has(path[0])) ||
    (path.length === 2 && names.namespaces.has(path[0]) && ["T", "Title"].includes(path[1]))
  );
}

function allowedElement(node, names) {
  const path = parts(node);
  if (path.length === 1 && INLINE_TAGS.has(path[0])) return true;
  if (path.length === 1 && names.facts.has(path[0])) return true;
  return path.length === 2 && names.namespaces.has(path[0]) && path[1] === "Fact";
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Restrict T and Title children to plain text and approved inline copy." },
  },
  create(context) {
    const stack = [];
    let names;
    return {
      Program(node) {
        names = importedTNames(node);
      },
      JSXElement(node) {
        const parent = stack.at(-1);
        if (parent?.insideT && !allowedElement(node.openingElement.name, names)) {
          context.report({
            node: node.openingElement.name,
            message: "T and Title accept text, em, strong, a, code, br, and Fact only.",
          });
        }
        stack.push({ insideT: isT(node.openingElement.name, names) || Boolean(parent?.insideT) });
      },
      "JSXElement:exit"() {
        stack.pop();
      },
      JSXFragment(node) {
        if (stack.at(-1)?.insideT)
          context.report({
            node,
            message:
              "T and Title accept text, em, strong, a, code, br, and Fact only; fragments are not supported.",
          });
      },
    };
  },
};
