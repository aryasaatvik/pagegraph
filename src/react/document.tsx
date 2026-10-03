import { createContext, isValidElement, useContext, useId, useMemo } from "react";
import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";

import type {
  BodyEntry,
  InlineNode,
  Message,
  PageDocument,
  SectionDocument,
  SectionItem,
} from "../markdown/document";
import { documentLinkHref, inlineMarkdown, plainText } from "../markdown/inline";
import { hashDocument } from "../markdown/document";
import { resolveFact } from "../markdown/facts";
import type { Facts } from "../markdown/facts";
import { contentHash } from "../markdown/hash";
import type { Register } from "../core/index";
import type { SectionKind } from "../markdown/markdown";

/** Augment with `facts: typeof facts` to check Fact ids across the application. */

export type FactId = Register extends { facts: infer F extends Facts }
  ? Extract<keyof F, string>
  : string;
type Audience = Message["audience"];
type MutableSection = Omit<SectionDocument, "title" | "body" | "items"> & {
  title?: Message;
  body: Array<BodyEntry>;
  items: Array<MutableItem>;
};
type MutableItem = Omit<SectionItem, "title" | "href" | "body" | "cells"> & {
  title?: Message;
  href?: string;
  body: Array<BodyEntry>;
  cells: Array<Message>;
};
export interface Collector {
  path: string;
  site: string;
  facts?: Facts;
  sectionCount: number;
  sections: Array<MutableSection>;
  messages: Array<Message>;
  records: Map<string, () => void>;
  links: Set<MutableItem>;
  completed: boolean;
}
interface CaptureContext {
  collector: Collector;
  section?: MutableSection;
  item?: MutableItem;
  audience: Audience;
  suppress: boolean;
  link?: string | undefined;
}
export const CaptureRequest = createContext<Collector | undefined>(undefined);
const Capture = createContext<CaptureContext | undefined>(undefined);

function CaptureProvider({
  collector,
  section,
  item,
  audience,
  suppress,
  link,
  children,
}: CaptureContext & { children?: ReactNode }) {
  const value = useMemo(
    () => ({
      collector,
      ...(section === undefined ? {} : { section }),
      ...(item === undefined ? {} : { item }),
      audience,
      suppress,
      ...(link === undefined ? {} : { link }),
    }),
    [collector, section, item, audience, suppress, link],
  );
  return <Capture.Provider value={value}>{children}</Capture.Provider>;
}

interface ChildrenProps {
  children?: ReactNode;
  source?: string;
}
interface FactProps {
  id: FactId;
  list?: boolean;
}
interface InlineProps extends ChildrenProps {
  href?: string;
}

export function createCollector(options: { path: string; site: string; facts?: Facts }): Collector {
  return {
    ...options,
    sectionCount: 0,
    sections: [],
    messages: [],
    records: new Map(),
    links: new Set(),
    completed: false,
  };
}

/** Mark the page body; ancestor layouts remain outside the captured document. */
export function DocumentProvider({
  collector: supplied,
  children,
}: {
  collector?: Collector;
  children: ReactNode;
}) {
  const request = useContext(CaptureRequest);
  const collector = supplied ?? request;
  if (collector === undefined) return <>{children}</>;
  return (
    <CaptureProvider collector={collector} audience="all" suppress={false}>
      {children}
    </CaptureProvider>
  );
}

function record(context: CaptureContext, id: string, apply: () => void) {
  context.collector.records.set(id, apply);
  return <template data-document-record={id} />;
}

const sourceOf = (source: string | undefined): string => source ?? "<inline>:1";

function elementProps(node: ReactElement<InlineProps>): InlineProps {
  return node.props;
}
function factProps(node: ReactElement): { id: string; list?: boolean } {
  const props = node.props;
  if ((typeof props !== "object" || props === null) || !("id" in props) || typeof props.id !== "string") {
    throw new Error("Fact requires an id");
  }
  return { id: props.id, ...("list" in props && props.list === true ? { list: true } : {}) };
}

/** Sanitize without executing components: identity is authored text, inline marks and fact ids. */
export function inlineTree(
  node: ReactNode,
  options: { facts?: Facts; site?: string; path?: string } = {},
): Array<InlineNode> {
  if (node === undefined || node === null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap((child) => inlineTree(child, options));
  if (!isValidElement<InlineProps>(node))
    throw new Error("T only accepts text, em, strong, a, code, br, and Fact");
  if (node.type === T) return inlineTree(elementProps(node).children, options);
  if (node.type === Fact) {
    const { id, list } = factProps(node);
    const definition = resolveFact(id, options.facts);
    if (list && definition.kind !== "list")
      throw new Error(`Fact "${id}" is not a list`);
    return [{ fact: id, text: definition.text }];
  }
  const tag = node.type;
  if (tag !== "em" && tag !== "strong" && tag !== "a" && tag !== "code" && tag !== "br") {
    throw new Error(
      `T only accepts text, em, strong, a, code, br, and Fact; found ${typeof tag === "string" ? tag : "a component"}`,
    );
  }
  const props = elementProps(node);
  const href = tag === "a" ? props.href : undefined;
  if (tag === "a" && typeof href !== "string")
    throw new Error("An anchor in T needs a string href");
  return [
    {
      tag,
      ...(href === undefined
        ? {}
        : {
            href: documentLinkHref(
              href,
              options.site === undefined ? undefined : new URL(options.path ?? "/", options.site),
            ),
          }),
      children: inlineTree(props.children, options),
    },
  ];
}

function authoredTree(tree: ReadonlyArray<InlineNode>): unknown {
  return tree.map((node) =>
    typeof node === "string"
      ? node
      : "fact" in node
        ? { fact: node.fact }
        : {
            tag: node.tag,
            ...(node.href === undefined ? {} : { href: node.href }),
            children: authoredTree(node.children),
          },
  );
}
/** Static text for head()/JSON-LD; use format: "markdown" to retain inline marks. */
export function messageText(
  node: ReactNode,
  options: { format?: "text" | "markdown"; facts?: Facts; site?: string; path?: string } = {},
): string {
  const content =
    isValidElement<ChildrenProps>(node) && node.type === Title ? node.props.children : node;
  const tree = inlineTree(content, options);
  return options.format === "markdown" ? inlineMarkdown(tree) : plainText(tree);
}

function messageFor(node: ReactNode, source: string | undefined, context: CaptureContext): Message {
  const options = context.collector;
  // A whole-card destination is serialized on the item, rather than repeated on every message.
  const linkedContent =
    context.link === undefined || context.link === context.item?.href ? (
      node
    ) : (
      <a href={context.link}>{node}</a>
    );
  const tree = inlineTree(linkedContent, options);
  const authored = inlineTree(linkedContent, options.facts === undefined ? {} : { facts: options.facts });
  const refs = new Set<string>();
  const visit = (nodes: ReadonlyArray<InlineNode>): void => {
    for (const child of nodes) {
      if (typeof child !== "string") {
        if ("fact" in child) refs.add(child.fact);
        else visit(child.children);
      }
    }
  };
  visit(tree);
  const message: Message = {
    hash: contentHash(authoredTree(authored)).slice(0, 16),
    tree,
    text: plainText(tree),
    source: sourceOf(source),
    facts: [...refs],
    audience: context.audience,
  };
  return message;
}
function append(context: CaptureContext, entry: BodyEntry): void {
  if (context.item !== undefined) {
    context.item.body.push(entry);
    if (entry.type === "message") context.item.cells.push(entry.message);
  } else if (context.section !== undefined) context.section.body.push(entry);
  else {
    let section = context.collector.sections.at(-1);
    if (section?.kind !== `for-${context.audience}`) {
      section = {
        kind: `for-${context.audience}`,
        id: `for-${context.audience}-${context.collector.sections.length}`,
        body: [],
        items: [],
        source: entry.type === "message" ? entry.message.source : entry.source,
        audience: context.audience,
      };
      context.collector.sections.push(section);
    }
    section.body.push(entry);
  }
}

export function T({ children, source }: ChildrenProps) {
  const id = useId();
  const context = useContext(Capture);
  if (context === undefined || context.suppress) return <>{children}</>;
  const message = messageFor(children, source, context);
  const marker = record(context, id, () => {
    context.collector.messages.push(message);
    append(context, { type: "message", message });
  });
  return (
    <>
      {marker}
      {children}
    </>
  );
}
/**
 * Mark an inline heading in place without adding markup. Capture assigns it to the nearest
 * Section.Item, otherwise Section, and records one title message instead of body text.
 * Accepts the same inline children as T. A title prop or another Title on that owner is an error.
 */
export function Title({ children, source }: ChildrenProps) {
  const id = useId();
  const context = useContext(Capture);
  if (context === undefined || context.suppress) return <>{children}</>;
  const title = messageFor(children, source, context);
  const marker = record(context, id, () => {
    if (context.section === undefined)
      throw new Error(`Title outside Section on ${context.collector.path}`);
    const owner = context.item ?? context.section;
    if (owner.title !== undefined)
      throw new Error(
        `Duplicate document title for ${context.item === undefined ? `Section "${context.section.id}"` : `Section.Item at ${context.item.source}`} on ${context.collector.path}; use a title prop or one Title`,
      );
    owner.title = title;
    context.collector.messages.push(title);
    if (context.item !== undefined) context.item.cells.unshift(title);
  });
  return (
    <CaptureProvider {...context} suppress>
      {marker}
      {children}
    </CaptureProvider>
  );
}
export function Fact({ id, list }: FactProps) {
  const context = useContext(Capture);
  const definition = resolveFact(id, context?.collector.facts);
  if (list && definition.kind !== "list")
    throw new Error(`Fact "${id}" is not a list`);
  return <>{definition.text}</>;
}
function ItemRoot(
  props: ChildrenProps & {
    /** Capture-only heading; use Title to mark a visible heading in place. */
    title?: ReactNode;
  },
) {
  const key = useId();
  const { title, children, source } = props;
  const context = useContext(Capture);
  if (context === undefined || context.suppress) return <>{children}</>;
  if ("href" in props)
    throw new Error(
      `Section.Item does not accept href on ${context.collector.path}; render Section.Item.Link instead`,
    );
  if (context.section === undefined)
    throw new Error(`Section.Item outside Section on ${context.collector.path}`);
  const item: MutableItem = {
    body: [],
    cells: [],
    source: sourceOf(source),
    audience: context.audience,
  };
  const heading =
    title === undefined
      ? undefined
      : messageFor(
          title,
          isValidElement<ChildrenProps>(title) ? (title.props.source ?? source) : source,
          { ...context, item },
        );
  if (heading !== undefined) {
    item.title = heading;
    item.cells.push(heading);
  }
  const marker = record(context, key, () => {
    context.section?.items.push(item);
    if (heading !== undefined) context.collector.messages.push(heading);
  });
  return (
    <CaptureProvider {...context} item={item}>
      {marker}
      {children}
    </CaptureProvider>
  );
}
function SectionRoot({
  evidence,
  kind,
  id,
  title,
  language,
  children,
  source,
}: ChildrenProps & {
  kind: string | SectionKind;
  id: string;
  evidence?: boolean;
  /** Capture-only heading; use Title to mark a visible heading in place. */
  title?: ReactNode;
  language?: string;
}) {
  const key = useId();
  const context = useContext(Capture);
  if (context === undefined || context.suppress) return <>{children}</>;
  const heading =
    title === undefined
      ? undefined
      : messageFor(
          title,
          isValidElement<ChildrenProps>(title) ? (title.props.source ?? source) : source,
          context,
        );
  const section: MutableSection = {
    ...(evidence === undefined ? {} : { evidence }),
    kind: typeof kind === "string" ? kind : kind.kind,
    id,
    ...(heading === undefined ? {} : { title: heading }),
    ...(language === undefined ? {} : { language }),
    body: [],
    items: [],
    source: sourceOf(source),
    audience: context.audience,
  };
  const marker = record(context, key, () => {
    if (context.collector.sections.some((entry) => entry.id === id))
      throw new Error(`Duplicate document Section id "${id}" on ${context.collector.path}`);
    context.collector.sectionCount++;
    context.collector.sections.push(section);
    if (heading !== undefined) context.collector.messages.push(heading);
  });
  return (
    <CaptureProvider
      collector={context.collector}
      section={section}
      audience={context.audience}
      suppress={false}
    >
      {marker}
      {children}
    </CaptureProvider>
  );
}
/**
 * Render the card's anchor and record its destination on the enclosing Section.Item.
 * Use `createLink(Section.Item.Link)` for TanStack navigation: Router supplies the resolved href,
 * including params, search and hash, so the page and twin share one destination.
 * Anchor props and refs pass through. An item may contain only one such link;
 * capture rejects missing or disabled destinations.
 */
function ItemLink(props: ComponentPropsWithRef<"a">) {
  return <CapturedAnchor {...props} itemLink />;
}
const Item = Object.assign(ItemRoot, { Link: ItemLink });
export const Section = Object.assign(SectionRoot, { Item });
/**
 * Render children unchanged outside capture. Under DocumentProvider, children never render or record;
 * describe is the only twin output, and omitting it contributes nothing to the twin.
 */
export function Visual({ describe, children, source }: ChildrenProps & { describe?: string }) {
  const id = useId();
  const context = useContext(Capture);
  if (context === undefined) return <>{children}</>;
  if (context.suppress || describe === undefined) return null;
  return record(context, id, () =>
    append(context, {
      type: "visual",
      text: describe,
      source: sourceOf(source),
      audience: context.audience,
    }),
  );
}
function AudienceContent({
  audience,
  children,
}: ChildrenProps & { audience: "agents" | "humans" }) {
  const context = useContext(Capture);
  if (context === undefined) return audience === "agents" ? null : <>{children}</>;
  return (
    <CaptureProvider {...context} audience={audience}>
      {children}
    </CaptureProvider>
  );
}
export function ForAgents(props: ChildrenProps) {
  return <AudienceContent {...props} audience="agents" />;
}
export function ForHumans(props: ChildrenProps) {
  return <AudienceContent {...props} audience="humans" />;
}

export function finishDocument(
  collector: Collector,
  metadata: { title: string; description: string },
  html: string,
): PageDocument {
  if (collector.completed) throw new Error(`Document capture already completed for ${collector.path}`);
  collector.completed = true;
  // Only completed SSR output decides which attempted renders belong to the document and their order.
  collector.sections.length = 0;
  collector.messages.length = 0;
  collector.sectionCount = 0;
  collector.links.clear();
  for (const marker of html.matchAll(/<template data-document-record="([^"]+)"><\/template>/g)) {
    const apply = collector.records.get(marker[1] ?? "");
    if (apply === undefined) throw new Error(`Unknown document record on ${collector.path}`);
    apply();
  }
  if (collector.sectionCount === 0)
    throw new Error(`Document page ${collector.path} recorded no <Section>`);
  // Validate completed public rows after replay; abandoned renders and human-only rows do not count.
  for (const section of collector.sections) {
    if (section.kind !== "table" || section.audience === "humans") continue;
    const rows = section.items
      .filter((item) => item.audience !== "humans")
      .map((item) => ({
        source: item.source,
        width: item.cells.filter((cell) => cell.audience !== "humans").length,
      }));
    const expected = rows[0]?.width;
    const invalid = rows.find((row) => row.width === 0 || row.width !== expected);
    if (invalid !== undefined)
      throw new Error(
        `Table Section "${section.id}" on ${collector.path} needs equal, nonempty visible cell counts after excluding ForHumans; row at ${invalid.source} has ${invalid.width}, expected ${expected}`,
      );
  }
  const document = {
    path: collector.path,
    ...metadata,
    sections: collector.sections,
    messages: collector.messages,
    facts: [...new Set(collector.messages.flatMap((message) => message.facts))],
  };
  return { ...document, hash: hashDocument(document) };
}

export function useCapturePage(): string | undefined {
  return useContext(Capture)?.collector.path;
}

function CapturedAnchor({
  itemLink = false,
  ...props
}: ComponentPropsWithRef<"a"> & { itemLink?: boolean }) {
  const key = useId();
  const context = useContext(Capture);
  if (context === undefined || context.suppress) return <a {...props} />;
  if (itemLink && context.item === undefined)
    throw new Error(`Section.Item.Link outside Section.Item on ${context.collector.path}`);
  if (typeof props.href !== "string")
    throw new Error(`Document page ${context.collector.path}: Link requires a resolved href`);
  const href = documentLinkHref(props.href, new URL(context.collector.path, context.collector.site));
  const item = context.item;
  const marker =
    itemLink && item !== undefined
      ? record(context, key, () => {
          if (context.collector.links.has(item))
            throw new Error(
              `Duplicate Section.Item.Link at ${item.source} on ${context.collector.path}`,
            );
          context.collector.links.add(item);
          item.href = href;
        })
      : null;
  return (
    <CaptureProvider {...context} link={itemLink ? undefined : href}>
      {marker}
      <a {...props} />
    </CaptureProvider>
  );
}

/** Host for TanStack createLink: capture receives the same resolved anchor props as normal SSR. */
export function CaptureAnchor(props: ComponentPropsWithRef<"a">) {
  return <CapturedAnchor {...props} />;
}
