import { contentHash } from "./hash";

/** Reserved for synthetic sections; capture rejects authored ids in this namespace. */
export const RESERVED_SECTION_ID_PREFIX = "__pagegraph:";
export const HEAD_SECTION_ID = `${RESERVED_SECTION_ID_PREFIX}head`;

export type InlineNode =
  | string
  | { readonly fact: string; readonly text: string }
  | {
      readonly tag: "em" | "strong" | "a" | "code" | "br";
      readonly href?: string;
      readonly children: ReadonlyArray<InlineNode>;
    };
export interface Message {
  readonly hash: string;
  readonly tree: ReadonlyArray<InlineNode>;
  readonly text: string;
  readonly source: string;
  readonly facts: ReadonlyArray<string>;
  readonly audience: "all" | "agents" | "humans";
}
export interface VisualDocument {
  readonly type: "visual";
  readonly text: string;
  readonly source: string;
  readonly audience: Message["audience"];
}
export type BodyEntry = { readonly type: "message"; readonly message: Message } | VisualDocument;
export interface SectionItem {
  readonly title?: Message;
  /** Destination recorded from the item's rendered Section.Item.Link anchor. */
  readonly href?: string;
  readonly body: ReadonlyArray<BodyEntry>;
  readonly cells: ReadonlyArray<Message>;
  readonly source: string;
  readonly audience: Message["audience"];
}
export interface SectionDocument {
  /** Captured with human-only messages included for offline custom serializers. */
  readonly claimsMarkdown?: string;
  readonly evidence?: boolean;
  readonly kind: string;
  readonly id: string;
  readonly title?: Message;
  readonly language?: string;
  readonly body: ReadonlyArray<BodyEntry>;
  readonly items: ReadonlyArray<SectionItem>;
  readonly source: string;
  readonly audience: Message["audience"];
}
export interface PageDocument {
  readonly path: string;
  readonly hash: string;
  readonly title: string;
  readonly description: string;
  readonly sections: ReadonlyArray<SectionDocument>;
  readonly messages: ReadonlyArray<Message>;
  readonly facts: ReadonlyArray<string>;
}

/** The document includes resolved values; source relocation alone is not a content edit. */
export function hashDocument(document: Omit<PageDocument, "hash">): string {
  const withoutSource = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutSource);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "source")
          .map(([key, entry]) => [key, withoutSource(entry)]),
      );
    }
    return value;
  };
  return contentHash(withoutSource(document));
}
