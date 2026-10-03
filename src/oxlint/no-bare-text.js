function importedDocumentNames(program) {
  const namespaces = new Set();
  const suppressNames = new Set();
  let runtimeImport = false;
  for (const declaration of program.body) {
    if (
      declaration.type !== "ImportDeclaration" ||
      declaration.source.value !== "pagegraph/react" ||
      declaration.importKind === "type"
    )
      continue;
    if (declaration.specifiers.length === 0) runtimeImport = true;
    for (const specifier of declaration.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type") {
        const imported = specifier.imported.name ?? specifier.imported.value;
        if (["T", "Title", "ForHumans"].includes(imported)) suppressNames.add(specifier.local.name);
        runtimeImport = true;
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(specifier.local.name);
        runtimeImport = true;
      } else if (specifier.type === "ImportDefaultSpecifier") runtimeImport = true;
    }
  }
  return { namespaces, suppressNames, runtimeImport };
}

function jsxName(node) {
  if (node.type === "JSXIdentifier") return [node.name];
  if (node.type === "JSXMemberExpression") return [...jsxName(node.object), node.property.name];
  return [];
}

function matchesFiles(filename, files) {
  if (!files?.length) return true;
  const normalized = filename.replaceAll("\\", "/");
  return files.some((pattern) => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    const regex = new RegExp(
      `(?:^|/)${escaped.replaceAll("**", "§").replaceAll("*", "[^/]*").replaceAll("§", ".*")}$`,
    );
    return regex.test(normalized);
  });
}

function* literalLabels(expression, stringsOnly = false) {
  switch (expression.type) {
    case "Literal":
      if (
        typeof expression.value === "string" ||
        (!stringsOnly && typeof expression.value === "number")
      )
        yield expression;
      break;
    case "ConditionalExpression":
      yield* literalLabels(expression.consequent, stringsOnly);
      yield* literalLabels(expression.alternate, stringsOnly);
      break;
    case "LogicalExpression":
      // A truthy string on the left of && is only a guard, never the returned child.
      if (expression.operator !== "&&") yield* literalLabels(expression.left, stringsOnly);
      yield* literalLabels(expression.right, stringsOnly);
      break;
    case "BinaryExpression":
      // Comparisons and numeric arithmetic consume their literals rather than displaying them.
      if (expression.operator === "+") {
        yield* literalLabels(expression.left, true);
        yield* literalLabels(expression.right, true);
      }
      break;
    case "TemplateLiteral":
      if (expression.quasis.some((part) => part.value.raw.trim())) yield expression;
      for (const interpolation of expression.expressions) yield* literalLabels(interpolation, true);
      break;
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Require customer-facing text to use pagegraph primitives." },
    schema: [
      {
        type: "object",
        properties: { files: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const files = context.options[0]?.files;
    if (!matchesFiles(context.filename, files)) return {};
    let active = false;
    let names;
    const suppressedRanges = [];
    const attributeExpressions = new Set();
    const report = (node) =>
      context.report({ node, message: "Wrap customer-facing text in T, Title, or ForHumans." });
    const isSuppressed = (node) =>
      suppressedRanges.some(([start, end]) => node.start >= start && node.end <= end);
    return {
      Program(node) {
        const imports = importedDocumentNames(node);
        active = imports.runtimeImport;
        names = imports;
      },
      JSXElement(node) {
        const parts = jsxName(node.openingElement.name);
        const suppressed =
          (parts.length === 1 && names.suppressNames.has(parts[0])) ||
          (parts.length === 2 &&
            names.namespaces.has(parts[0]) &&
            ["T", "Title", "ForHumans"].includes(parts[1]));
        if (active && suppressed) suppressedRanges.push([node.start, node.end]);
      },
      JSXText(node) {
        if (active && !isSuppressed(node) && node.value.trim()) report(node);
      },
      JSXAttribute(node) {
        // Exempt the prop value itself; nested JSX has its own children to check.
        if (active && node.value?.type === "JSXExpressionContainer")
          attributeExpressions.add(node.value.start);
      },
      JSXExpressionContainer(node) {
        if (active && !attributeExpressions.has(node.start) && !isSuppressed(node))
          for (const label of literalLabels(node.expression)) report(label);
      },
    };
  },
};
