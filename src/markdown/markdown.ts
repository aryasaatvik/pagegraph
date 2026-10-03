import type {
  BodyEntry,
  InlineNode,
  Message,
  PageDocument,
  SectionDocument,
  SectionItem,
} from "./document";
import { inlineMarkdown } from "./inline";

export interface MarkdownWriter {
  text(value: Message | string | undefined): string;
  heading(level: number, value: Message | string | undefined): string;
  table(rows: ReadonlyArray<ReadonlyArray<Message | string>>): string;
}
export interface SectionKind {
  readonly kind: string;
  readonly markdown: (section: SectionDocument, md: MarkdownWriter) => string;
}
const customKinds = new Map<string, SectionKind>();
const builtInKinds = new Set([
  "hero",
  "prose",
  "steps",
  "cards",
  "faq",
  "table",
  "code",
  "cta",
  "for-agents",
  "for-humans",
]);

/** A kind can be passed directly to Section; importing its definition registers its serializer. */
export function defineSectionKind<const K extends string>(
  definition: SectionKind & { kind: K },
): SectionKind & { kind: K } {
  if (!definition.kind || builtInKinds.has(definition.kind))
    throw new Error(`Cannot redefine document section kind "${definition.kind}"`);
  customKinds.set(definition.kind, definition);
  return definition;
}

const titleMarkdown = (value: Message | string | undefined): string => {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return value.audience === "humans" ? "" : inlineMarkdown(value.tree, { emphasis: false });
};

function linkedItemTitle(item: SectionItem, section: SectionDocument, href: string): string {
  const labelTree = (tree: ReadonlyArray<InlineNode>): Array<InlineNode> =>
    tree.flatMap((node): Array<InlineNode> => {
      if (typeof node === "string" || "fact" in node) return [node];
      if (node.tag === "a" && node.href !== href)
        throw new Error(`Linked item in section "${section.id}" at ${item.source} targets "${href}" but its title links to "${node.href}"`);
      const children = labelTree(node.children);
      return node.tag === "a" ? children : [{ ...node, children }];
    });
  const children =
    item.title === undefined || item.title.audience === "humans" ? [] : labelTree(item.title.tree);
  if (!inlineMarkdown(children, { emphasis: false }).trim())
    throw new Error(`Linked item in section "${section.id}" at ${item.source} targeting "${href}" needs a visible title`);
  return inlineMarkdown([{ tag: "a", href, children }], { emphasis: false });
}

export const markdown: MarkdownWriter = {
  text(value) {
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    return value.audience === "humans" ? "" : inlineMarkdown(value.tree);
  },
  heading(level, value) {
    const text = titleMarkdown(value);
    if (!Number.isInteger(level) || level < 1 || level > 6)
      throw new Error(`Invalid markdown heading level ${level}`);
    return text ? `${"#".repeat(level)} ${text}\n\n` : "";
  },
  table(rows) {
    if (rows.length === 0) return "";
    const width = rows[0]?.length;
    if (width === undefined || width === 0 || rows.some((row) => row.length !== width))
      throw new Error("Document table rows need equal, nonempty cells");
    const lines = rows.map(
      (row) =>
        `| ${row.map((cell) => this.text(cell).replaceAll("|", "\\|").replaceAll("\n", "<br>")).join(" | ")} |`,
    );
    lines.splice(1, 0, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
    return `${lines.join("\n")}\n\n`;
  },
};

const visibleBody = (body: ReadonlyArray<BodyEntry>): ReadonlyArray<BodyEntry> =>
  body.filter(
    (entry) => (entry.type === "message" ? entry.message.audience : entry.audience) !== "humans",
  );
const bodyMarkdown = (body: ReadonlyArray<BodyEntry>): string =>
  visibleBody(body)
    .map((entry) => (entry.type === "message" ? markdown.text(entry.message) : entry.text))
    .filter(Boolean)
    .join("\n\n");
const paragraph = (text: string): string => (text ? `${text}\n\n` : "");

function publicSection(section: SectionDocument): SectionDocument {
  const { claimsMarkdown: _claimsMarkdown, title: _title, ...visibleSection } = section;
  const publicMessage = (message: Message | undefined): Message | undefined =>
    message?.audience === "humans" ? undefined : message;
  const publicBody = (body: ReadonlyArray<BodyEntry>): Array<BodyEntry> =>
    body.filter(
      (entry) => (entry.type === "message" ? entry.message.audience : entry.audience) !== "humans",
    );
  const title = publicMessage(section.title);
  return {
    ...visibleSection,
    ...(title === undefined ? {} : { title }),
    body: publicBody(section.body),
    items: section.items
      .filter((item) => item.audience !== "humans")
      .map((item) => {
        const { title: _itemTitle, ...publicItem } = item;
        const itemTitle = publicMessage(item.title);
        return {
          ...publicItem,
          ...(itemTitle === undefined ? {} : { title: itemTitle }),
          body: publicBody(item.body),
          cells: item.cells.filter((cell) => cell.audience !== "humans"),
        };
      }),
  };
}

export function sectionMarkdown(
  section: SectionDocument,
  options: { includeHumans?: boolean } = {},
): string {
  if (options.includeHumans) {
    const message = (value: Message): Message => ({ ...value, audience: "all" });
    const body = (entries: ReadonlyArray<BodyEntry>): ReadonlyArray<BodyEntry> =>
      entries.map((entry) =>
        entry.type === "message"
          ? { ...entry, message: message(entry.message) }
          : { ...entry, audience: "all" },
      );
    return sectionMarkdown({
      ...section,
      audience: "all",
      ...(section.title === undefined ? {} : { title: message(section.title) }),
      body: body(section.body),
      items: section.items.map((item) => ({
        ...item,
        audience: "all",
        ...(item.title === undefined ? {} : { title: message(item.title) }),
        body: body(item.body),
        cells: item.cells.map(message),
      })),
    });
  }
  if (section.audience === "humans") return "";
  const custom = customKinds.get(section.kind);
  if (custom !== undefined) return custom.markdown(publicSection(section), markdown);
  const items = section.items.filter((item) => item.audience !== "humans");
  const heading = markdown.heading(2, section.title);
  const body = paragraph(bodyMarkdown(section.body));
  switch (section.kind) {
    case "hero": {
      const entries = visibleBody(section.body);
      const title =
        section.title ?? (entries[0]?.type === "message" ? entries[0].message : undefined);
      if (title === undefined)
        throw new Error(`Hero "${section.id}" needs a document heading`);
      return (
        markdown.heading(1, title) +
        paragraph(bodyMarkdown(section.title === undefined ? entries.slice(1) : entries))
      );
    }
    case "prose":
    case "cta":
    case "for-agents":
    case "for-humans":
      return heading + body;
    case "steps":
    case "cards":
      return (
        heading +
        body +
        paragraph(
          items
            .map((item, index) => {
              const title =
                section.kind === "cards" && item.href !== undefined
                  ? linkedItemTitle(item, section, item.href)
                  : titleMarkdown(item.title);
              const label =
                title && section.kind === "cards" && item.href !== undefined
                  ? title
                  : title
                    ? `**${title}**`
                    : "";
              const prefix = section.kind === "steps" ? `${index + 1}.` : "-";
              const content = bodyMarkdown(item.body).replaceAll("\n", "\n   ");
              return `${prefix} ${label ? `${label}${section.kind === "cards" && content ? ":" : ""} ` : ""}${content}`.trimEnd();
            })
            .join("\n"),
        )
      );
    case "faq":
      return (
        heading +
        body +
        items
          .map((item) => markdown.heading(3, item.title) + paragraph(bodyMarkdown(item.body)))
          .join("")
      );
    case "table":
      return (
        heading +
        body +
        markdown.table(items.map((item) => item.cells.filter((cell) => cell.audience !== "humans")))
      );
    case "code": {
      const code = visibleBody(section.body)
        .map((entry) => (entry.type === "message" ? entry.message.text : entry.text))
        .join("\n");
      const fence = "`".repeat(
        Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length)) + 1,
      );
      return heading + `${fence}${section.language ?? ""}\n${code}\n${fence}\n\n`;
    }
    default:
      throw new Error(`Unknown document section kind "${section.kind}"; use defineSectionKind`);
  }
}

/** One public twin, in authored section order. Human-only messages never enter it. */
export function documentMarkdown(document: PageDocument, site: string): string {
  const parts = document.sections.map((section) => sectionMarkdown(section));
  const url = `URL: ${new URL(document.path, site).href}\n\n`;
  const heroIndex = document.sections.findIndex(
    (section) => section.kind === "hero" && section.audience !== "humans",
  );
  if (heroIndex === -1)
    return `${markdown.heading(1, document.title)}${url}${parts.join("")}`.trimEnd() + "\n";
  const hero = parts[heroIndex];
  if (hero === undefined)
    throw new Error(`Missing hero on ${document.path}`);
  const end = hero.indexOf("\n\n");
  parts[heroIndex] = hero.slice(0, end + 2) + url + hero.slice(end + 2);
  return parts.join("").trimEnd() + "\n";
}
