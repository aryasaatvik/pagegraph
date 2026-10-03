import type { InlineNode } from "./document";

const unsafeMarkdownChars = /[()\\<> \u0000-\u001f\u007f]/g;
export function documentLinkHref(value: string, base?: URL): string {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value.trim())?.[1]?.toLowerCase();
  if (scheme !== undefined && !["http", "https", "mailto", "tel"].includes(scheme))
    throw new Error(`Unsafe copy link protocol "${scheme}:"`);
  const encoded = value.replace(
    unsafeMarkdownChars,
    (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}`,
  );
  if (base !== undefined) return new URL(encoded, base).href;
  if (scheme !== undefined) return new URL(encoded).href;
  return encoded;
}

export function plainText(tree: ReadonlyArray<InlineNode>): string {
  return tree
    .map((node) => {
      if (typeof node === "string") return node;
      if ("fact" in node) return node.text;
      if (node.tag === "br") return "\n";
      return plainText(node.children);
    })
    .join("");
}
const escapeMarkdown = (text: string): string => text.replace(/([\\`*_[\]<>])/g, "\\$1");
export function inlineMarkdown(
  tree: ReadonlyArray<InlineNode>,
  options: { emphasis?: boolean } = {},
): string {
  return tree
    .map((node): string => {
      if (typeof node === "string") return escapeMarkdown(node);
      if ("fact" in node) return escapeMarkdown(node.text);
      const children = inlineMarkdown(node.children, options);
      switch (node.tag) {
        case "em":
          return options.emphasis === false ? children : `*${children}*`;
        case "strong":
          return options.emphasis === false ? children : `**${children}**`;
        case "a":
          if (node.href === undefined)
            throw new Error("An anchor in T needs a string href");
          return `[${children}](${documentLinkHref(node.href)})`;
        case "code": {
          const text = plainText(node.children);
          const runs = text.match(/`+/g) ?? [];
          const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
          return `${fence}${text.includes("`") ? " " : ""}${text}${text.includes("`") ? " " : ""}${fence}`;
        }
        case "br":
          return "  \n";
      }
    })
    .join("");
}
