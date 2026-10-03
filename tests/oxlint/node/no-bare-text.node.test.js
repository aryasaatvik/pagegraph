import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import noBareText from "../../../src/oxlint/no-bare-text.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" }, sourceType: "module" },
});
tester.run("no-bare-text", noBareText, {
  valid: [
    {
      code: 'import { T } from "pagegraph/react"; const x = <button title={"Hello"} label={loading ? "Wait" : "Continue"} aria-label={"Hello " + name} data-label={`Hello ${name}`} onClick={() => notify("clicked")}/>;',
    },
    {
      code: 'import { T } from "pagegraph/react"; const x = <Widget label={<span><T>Prop text</T></span>} {...{label: "Hello", content: <span><T>Prop text</T></span>}}/>;',
    },
    ...[
      '<Widget label={<T>Continue</T>} title="x"/>',
      "<Widget label={cond ? <T>A</T> : null}/>",
      "<Widget label={cond && <T>A</T>}/>",
      "<Widget icon={<><b><T>New</T></b></>}/>",
      '<Widget label={<span title={"x"}><T>Continue</T></span>}/>',
      '<Widget label={cond ? <T>A</T> : "Attribute string"}/>',
      '<Widget label={<span title="x"/>}/>',
    ].map((jsx) => ({ code: `import { T } from "pagegraph/react"; const x = ${jsx};` })),
    {
      code: 'import * as Copy from "pagegraph/react"; const x = <Widget label={<Copy.T>Continue</Copy.T>}/>;',
    },
    {
      code: 'import { Title as Heading, ForHumans as Humans } from "pagegraph/react"; const x = <Widget label={<Heading>Continue</Heading>} icon={<Humans><b>New</b></Humans>}/>;',
    },
    ...[
      'status === "ready" ? label : fallback',
      '"guard" && label',
      'lookup("ready")',
      'labels["ready"]',
      "count + 1",
      '`${status === "ready"}`',
    ].map((expression) => ({
      code: `import { T } from "pagegraph/react"; const x = <p>{${expression}}</p>;`,
    })),
    {
      code: 'import { T as Text, Title as Heading, ForHumans as Humans } from "pagegraph/react"; const x = <><Text>{loading ? "Wait" : "Continue"}</Text><Heading>{"Hello " + name}</Heading><Humans>{`Hello ${name}`}</Humans></>;',
    },
    {
      code: 'import * as Copy from "pagegraph/react"; const x = <Copy.T>{loading && "Wait"}</Copy.T>;',
    },
    {
      code: 'import { T } from "pagegraph/react"; const label = loading ? "Wait" : "Continue"; const x = <p>{label}</p>;',
    },
    { code: `const x = <div>ordinary</div>;` },
    { code: `import { type T } from "pagegraph/react"; const x = <div>ordinary</div>;` },
    { code: `import type { T } from "pagegraph/react"; const x = <div>ordinary</div>;` },
    {
      code: `import { T as Text, ForHumans as Humans } from "pagegraph/react"; const x = <><Text>Label</Text><Humans>Accessible text</Humans></>;`,
    },
    { code: `import { T } from "pagegraph/react"; const x = <T>Label</T>;` },
    {
      code: `import { Title as Heading } from "pagegraph/react"; const x = <h2><Heading>Label</Heading></h2>;`,
    },
    {
      code: `import * as Copy from "pagegraph/react"; const x = <h2><Copy.Title>{"Label"}</Copy.Title></h2>;`,
    },
    { code: `import * as Copy from "pagegraph/react"; const x = <Copy.T>Label</Copy.T>;` },
    {
      filename: "src/routes/(docs)/page.tsx",
      options: [{ files: ["(marketing)/**"] }],
      code: `import { T } from "pagegraph/react"; const x = <div>outside</div>;`,
    },
  ],
  invalid: [
    ...[
      ["<Widget label={<span>Continue</span>}/>", 1],
      ["<Widget label={cond ? <span>A</span> : null}/>", 1],
      ["<Widget icon={<><b>New</b></>}/>", 1],
      ["<Widget label={cond && <span>Wait</span>}/>", 1],
      ["<Widget label={node || <span>Fallback</span>}/>", 1],
      ["<Widget label={node ?? <span>Fallback</span>}/>", 1],
      ["<Widget label={cond ? <span>A</span> : <span>B</span>}/>", 2],
      ['<Widget label={<span>{cond ? "Wait" : "Continue"}</span>}/>', 2],
      ["<Widget label={<span>{`Hello ${name}`}</span>}/>", 1],
      ['<Widget label={cond ? <span title="x">A</span> : "Attribute string"}/>', 1],
      [
        '<Widget label={<span>{"Prop text"}</span>} {...{label: "Hello", content: <span>Prop text</span>}}/>',
        2,
      ],
    ].map(([jsx, count]) => ({
      code: `import { T } from "pagegraph/react"; const x = ${jsx};`,
      errors: Array.from({ length: count }, () => ({ message: /Wrap customer-facing text/ })),
    })),
    ...[
      ['loading ? "Wait" : "Continue"', 2],
      ['count > 0 ? (loading ? "Wait" : "Continue") : "Empty"', 3],
      ['status === "ready" ? "Continue" : "Wait"', 2],
      ['"Hello " + name', 1],
      ['name + "!"', 1],
      ['"Hello " + name + "!"', 2],
      ["`Hello ${name}`", 1],
      ['`${loading ? "Wait" : "Continue"}`', 2],
      ['`Hello ${loading ? "friend" : "guest"}`', 3],
      ['loading && "Wait"', 1],
      ['label || "Continue"', 1],
      ['"Welcome" || label', 1],
      ['label ?? "Continue"', 1],
      ['loading && (label || "Wait")', 1],
    ].map(([expression, count]) => ({
      code: `import { T } from "pagegraph/react"; const x = <p>{${expression}}</p>;`,
      errors: Array.from({ length: count }, () => ({ message: /Wrap customer-facing text/ })),
    })),
    {
      code: `import { Title } from "pagegraph/react"; const x = <h2>Label</h2>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
    {
      code: `import "pagegraph/react"; const x = <div>Welcome</div>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
    {
      code: `import { T } from "pagegraph/react"; const x = <div>Welcome</div>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
    {
      code: `import { T } from "pagegraph/react"; const x = <button>{"Continue"}</button>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
    {
      code: `import * as Copy from "pagegraph/react"; const x = <div>{\`Welcome\`}</div>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
    {
      filename: "src/routes/(marketing)/page.tsx",
      options: [{ files: ["(marketing)/**"] }],
      code: `import { T } from "pagegraph/react"; const x = <div>Welcome</div>;`,
      errors: [{ message: /Wrap customer-facing text/ }],
    },
  ],
});
