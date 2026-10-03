import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import tChildren from "../../../src/oxlint/t-children.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" }, sourceType: "module" },
});
tester.run("t-children", tChildren, {
  valid: [
    {
      code: `import { Title as Heading, Fact } from "pagegraph/react"; const x = <Heading>Plain<em>soft</em><Fact id="f"/></Heading>;`,
    },
    {
      code: `import * as Copy from "pagegraph/react"; const x = <Copy.Title><strong>Bold</strong><Copy.Fact id="f"/></Copy.Title>;`,
    },
    {
      code: `import { T, Fact } from "pagegraph/react"; const x = <T>Plain {"string"} {42}<em>soft</em><strong>bold</strong><a href="/">link</a><code>x</code><br/><Fact id="f"/></T>;`,
    },
    {
      code: `import * as Copy from "pagegraph/react"; const x = <Copy.T>Plain<em>soft</em><Copy.Fact id="f"/></Copy.T>;`,
    },
    { code: `import { T } from "pagegraph/react"; const x = <div><em>outside T</em></div>;` },
    { code: `import type { T } from "pagegraph/react"; const x = <T><div>type-only</div></T>;` },
  ],
  invalid: [
    {
      code: `import { Title } from "pagegraph/react"; const x = <Title><Title>Nested</Title></Title>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import { T } from "pagegraph/react"; const x = <T><div>bad</div></T>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import { T } from "pagegraph/react"; const x = <T>{ok && <Widget/>}</T>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import { T as Text } from "pagegraph/react"; const x = <Text><><em>x</em></></Text>;`,
      errors: [{ message: /fragments are not supported/ }],
    },
    {
      code: `import { T } from "pagegraph/react"; const x = <T><em><Widget/></em></T>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import { Title as Heading } from "pagegraph/react"; const x = <Heading><div>bad</div></Heading>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import * as Copy from "pagegraph/react"; const x = <Copy.Title><strong><Widget/></strong></Copy.Title>;`,
      errors: [{ message: /T and Title accept text/ }],
    },
    {
      code: `import { Title } from "pagegraph/react"; const x = <Title><>Fragment</></Title>;`,
      errors: [{ message: /fragments are not supported/ }],
    },
  ],
});
