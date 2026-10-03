import * as Schema from "effect/Schema";

import type { InlineNode as InlineNodeType, PageDocument as PageDocumentType } from "./document";

const InlineNode: Schema.Codec<InlineNodeType> = Schema.suspend(() => Schema.Union([
  Schema.String,
  Schema.Struct({ fact: Schema.String, text: Schema.String }),
  Schema.Struct({
    tag: Schema.Literals(["em", "strong", "a", "code", "br"]),
    href: Schema.optionalKey(Schema.String),
    children: Schema.Array(InlineNode),
  }),
]));
const Message = Schema.Struct({
  hash: Schema.String, tree: Schema.Array(InlineNode), text: Schema.String,
  source: Schema.String, facts: Schema.Array(Schema.String),
  audience: Schema.Literals(["all", "agents", "humans"]),
});
const BodyEntry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("message"), message: Message }),
  Schema.Struct({ type: Schema.Literal("visual"), text: Schema.String, source: Schema.String,
    audience: Schema.Literals(["all", "agents", "humans"]) }),
]);
export const PageDocument: Schema.Codec<PageDocumentType> = Schema.Struct({
  path: Schema.String, hash: Schema.String, title: Schema.String, description: Schema.String,
  sections: Schema.Array(Schema.Struct({
    claimsMarkdown: Schema.optionalKey(Schema.String), evidence: Schema.optionalKey(Schema.Boolean),
    kind: Schema.String, id: Schema.String, title: Schema.optionalKey(Message),
    language: Schema.optionalKey(Schema.String), body: Schema.Array(BodyEntry),
    items: Schema.Array(Schema.Struct({
      title: Schema.optionalKey(Message), href: Schema.optionalKey(Schema.String),
      body: Schema.Array(BodyEntry), cells: Schema.Array(Message), source: Schema.String,
      audience: Schema.Literals(["all", "agents", "humans"]),
    })), source: Schema.String, audience: Schema.Literals(["all", "agents", "humans"]),
  })), messages: Schema.Array(Message), facts: Schema.Array(Schema.String),
});
export const CaptureBundle = Schema.Struct({
  origin: Schema.String,
  documents: Schema.Array(PageDocument),
  heads: Schema.Array(Schema.Struct({ path: Schema.String, title: Schema.String, description: Schema.String })),
});

