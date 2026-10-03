import { describe, expect, it } from "@effect/vitest";

import { transformDocumentSource } from "../../src/tanstack-start/source";

const root = "/repo";

describe("document source transform", () => {
  it("adds source locations to in-place titles including aliases and namespaces", () => {
    const code =
      'import { Title as Heading } from "pagegraph/react";\nimport * as Copy from "pagegraph/react";\nconst page = <><Heading>Heading</Heading><Copy.Title>Item</Copy.Title></>;';
    const result = transformDocumentSource(code, "/repo/src/page.tsx", root)?.code;
    expect(result).toContain('<Heading source="src/page.tsx:3">');
    expect(result).toContain('<Copy.Title source="src/page.tsx:3">');
  });
  it("adds file and line metadata for aliased and namespace imports", () => {
    const code = `import { T as Text, Section, T } from "pagegraph/react";\nimport * as Copy from "pagegraph/react";\nconst page = <><Text>Hi</Text><Section.Item>Body</Section.Item><Copy.Section.Item>Nested</Copy.Section.Item><Copy.Visual/><Copy.ForAgents/><Copy.ForHumans/><T.Item>Unrelated</T.Item></>;`;
    expect(transformDocumentSource(code, "/repo/src/page.tsx", root)?.code).toContain(
      '<Text source="src/page.tsx:3">Hi</Text>',
    );
    const result = transformDocumentSource(code, "/repo/src/page.tsx", root)?.code;
    expect(result).toContain('<Section.Item source="src/page.tsx:3">');
    expect(result).toContain('<Copy.Section.Item source="src/page.tsx:3">');
    expect(result).toContain("<T.Item>Unrelated</T.Item>");
    expect(result).toContain('<Copy.Visual source="src/page.tsx:3"/>');
    expect(result).toContain('<Copy.ForAgents source="src/page.tsx:3"/>');
    expect(result).toContain('<Copy.ForHumans source="src/page.tsx:3"/>');
  });

  it("preserves an existing source attribute", () => {
    const code = `import { T } from "pagegraph/react";\nconst page = <T source="authored">Hi</T>;`;
    expect(transformDocumentSource(code, "/repo/page.tsx", root)).toBeUndefined();
  });

  it("preserves router imports, including Link and namespaces", () => {
    const code = `import { Link } from "@tanstack/react-router";
import * as Router from "@tanstack/react-router";
import { T } from "pagegraph/react";
const page = <T><Link to="/">Home</Link><Router.Link to="/">Home</Router.Link></T>;`;
    const result = transformDocumentSource(code, "/repo/page.tsx", root)?.code;
    expect(result).toContain('import { Link } from "@tanstack/react-router"');
    expect(result).toContain('import * as Router from "@tanstack/react-router"');
    expect(result).toContain('<T source="page.tsx:4">');
  });

  it("ignores type-only document imports and unrelated components", () => {
    const code = `import type { T } from "pagegraph/react";
import { type Title } from "pagegraph/react";
const page = <><T/><Title/></>;`;
    expect(transformDocumentSource(code, "/repo/page.tsx", root)).toBeUndefined();
  });
});
