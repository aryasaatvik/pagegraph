import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type PackResult = {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly files: ReadonlyArray<{ readonly path: string }>;
};

type PackageManifest = {
  readonly name: string;
  readonly version: string;
  readonly repository: { readonly type: string; readonly url: string };
  readonly homepage: string;
  readonly bugs: { readonly url: string };
  readonly bin: Record<string, string>;
  readonly exports: Record<string, Record<string, string>>;
  readonly publishConfig: { readonly access: string; readonly registry: string };
  readonly peerDependencies: Record<string, string>;
  readonly peerDependenciesMeta: Record<string, { readonly optional?: boolean }>;
  readonly devDependencies: Record<string, string>;
};

type RunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type AuditFixtureFinding = {
  readonly scanner: string;
  readonly target: string;
  readonly severity: "structural" | "editorial";
  readonly rule: string;
  readonly message: string;
};

type AuditFixtureReport = {
  readonly schemaVersion: unknown;
  generatedAt: string;
  readonly targets: Array<string>;
  readonly results: Array<{
    readonly scanner: string;
    readonly target: string;
    readonly findings: Array<AuditFixtureFinding>;
  }>;
  readonly findings: Array<AuditFixtureFinding>;
};

const root = path.resolve(import.meta.dir, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "pagegraph-release-"));
const packDirectory = path.join(temporary, "pack");
const installDirectory = path.join(temporary, "consumer");
const packageName = "pagegraph";
const repositoryUrl = "git+https://github.com/aryasaatvik/pagegraph.git";

const run = async (
  command: ReadonlyArray<string>,
  cwd: string,
  options: { readonly env?: Record<string, string | undefined> } = {},
): Promise<RunResult> => {
  const child = Bun.spawn(command, {
    cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const runSuccessfully = async (
  command: ReadonlyArray<string>,
  cwd: string,
  options: { readonly env?: Record<string, string | undefined> } = {},
): Promise<string> => {
  const result = await run(command, cwd, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode})\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
};

const stripAnsi = (output: string): string =>
  output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");

const parsePackOutput = (output: string): ReadonlyArray<PackResult> => {
  const normalized = stripAnsi(output).trim();
  const jsonStart = normalized.lastIndexOf("\n[");
  return JSON.parse(
    jsonStart === -1 ? normalized : normalized.slice(jsonStart + 1),
  ) as ReadonlyArray<PackResult>;
};

const assertPackageIdentity = (manifest: PackageManifest): void => {
  if (manifest.name !== packageName) {
    throw new Error(`Package name must be ${packageName}, received ${manifest.name}`);
  }
  if (manifest.repository.type !== "git" || manifest.repository.url !== repositoryUrl) {
    throw new Error(`Package repository must be ${repositoryUrl}`);
  }
  if (manifest.homepage !== "https://github.com/aryasaatvik/pagegraph#readme") {
    throw new Error("Package homepage must point to the owned repository");
  }
  if (manifest.bugs.url !== "https://github.com/aryasaatvik/pagegraph/issues") {
    throw new Error("Package bugs URL must point to the owned repository");
  }
  if (
    manifest.publishConfig.access !== "public" ||
    manifest.publishConfig.registry !== "https://registry.npmjs.org"
  ) {
    throw new Error("Package publish configuration must target the public npm registry");
  }
  if (JSON.stringify(manifest.bin) !== JSON.stringify({ pagegraph: "./dist/cli.js" })) {
    throw new Error("Package must expose only the pagegraph bin from dist/cli.js");
  }

  const buildEntry = (entry: string, file = entry) => ({
    types: `./dist/${file}.d.ts`,
    workerd: `./dist/build-only/${entry}.js`,
    worker: `./dist/build-only/${entry}.js`,
    browser: `./dist/build-only/${entry}.js`,
    import: `./dist/${file}.js`,
  });
  const expectedExports = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./react": { types: "./dist/react.d.ts", import: "./dist/react.js" },
    "./tanstack-start/server": {
      types: "./dist/tanstack-start/server.d.ts",
      import: "./dist/tanstack-start/server.js",
    },
    "./tanstack-start/markdown": {
      types: "./dist/tanstack-start/markdown.d.ts",
      import: "./dist/tanstack-start/markdown.js",
    },
    "./tanstack-start/react": {
      types: "./dist/tanstack-start/react.d.ts",
      import: "./dist/tanstack-start/react.js",
    },
    "./tanstack-start/prerender-worker": {
      types: "./dist/tanstack-start/prerender-worker.d.ts",
      import: "./dist/tanstack-start/prerender-worker.js",
    },
    "./vite": buildEntry("vite"),
    "./config": buildEntry("config"),
    "./audit": buildEntry("audit"),
    "./tanstack-start": buildEntry("tanstack-start", "tanstack-start/index"),
    "./oxlint": buildEntry("oxlint"),
    "./claims": buildEntry("claims"),
  };
  if (JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)) {
    throw new Error("Package exports do not match the supported public entry points");
  }

  for (const peer of ["effect", "@effect/platform-bun", "lighthouse", "vite", "@tanstack/router-generator"] as const) {
    if (manifest.peerDependencies[peer] === undefined) {
      throw new Error(`Package must declare ${peer} as a peer dependency`);
    }
    if (manifest.peerDependenciesMeta[peer]?.optional !== true) {
      throw new Error(`${peer} must remain an optional peer dependency`);
    }
  }

  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF_TYPE === "tag") {
    const expectedTag = `v${manifest.version}`;
    if (process.env.GITHUB_REF_NAME !== expectedTag) {
      throw new Error(`GitHub releases must run from ${expectedTag}`);
    }
  }
};

try {
  await mkdir(packDirectory);
  await mkdir(installDirectory);

  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as PackageManifest;
  assertPackageIdentity(manifest);

  const packOutput = await runSuccessfully(
    [
      "npm",
      "pack",
      "--json",
      "--color=false",
      "--pack-destination",
      packDirectory,
    ],
    root,
    {
      env: {
        ...process.env,
        FORCE_COLOR: undefined,
        NO_COLOR: "1",
      },
    },
  );
  const [packed] = parsePackOutput(packOutput);
  if (packed === undefined) throw new Error("npm pack did not produce an artifact");
  if (packed.name !== manifest.name || packed.version !== manifest.version) {
    throw new Error("Packed artifact metadata does not match package.json");
  }

  const included = new Set(packed.files.map((file) => file.path));
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/react.js",
    "dist/react.d.ts",
    "dist/vite.js",
    "dist/vite.d.ts",
    "dist/config.js",
    "dist/config.d.ts",
    "dist/audit.js",
    "dist/audit.d.ts",
    "dist/claims.js",
    "dist/claims.d.ts",
    "dist/build-only/claims.js",
    "dist/oxlint.js",
    "dist/oxlint.d.ts",
    "dist/build-only/oxlint.js",
    "dist/cli.js",
    "dist/build-only/vite.js",
    "dist/build-only/config.js",
    "dist/build-only/audit.js",
    "dist/build-only/tanstack-start.js",
    "dist/tanstack-start/index.js",
    "dist/tanstack-start/index.d.ts",
    "dist/tanstack-start/server.js",
    "dist/tanstack-start/server.d.ts",
    "dist/tanstack-start/markdown.js",
    "dist/tanstack-start/markdown.d.ts",
    "dist/tanstack-start/react.js",
    "dist/tanstack-start/react.d.ts",
    "dist/tanstack-start/prerender-worker.js",
    "dist/tanstack-start/prerender-worker.d.ts",
    "README.md",
    "LICENSE",
    "package.json",
  ]) {
    if (!included.has(required)) throw new Error(`Packed artifact is missing ${required}`);
  }

  const tarball = path.join(packDirectory, packed.filename);
  await Bun.write(
    path.join(installDirectory, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        // A consumer of the build entries installs their optional peers.
        dependencies: {
          [packageName]: `file:${tarball}`,
          vite: manifest.devDependencies["vite"],
          "@tanstack/router-generator": manifest.devDependencies["@tanstack/router-generator"],
        },
      },
      null,
      2,
    ),
  );
  await runSuccessfully(
    ["npm", "install", "--ignore-scripts"],
    installDirectory,
  );

  const installedRoot = path.join(installDirectory, "node_modules", packageName);
  const installedManifest = JSON.parse(
    await readFile(path.join(installedRoot, "package.json"), "utf8"),
  ) as PackageManifest;
  assertPackageIdentity(installedManifest);
  if (installedManifest.version !== manifest.version) {
    throw new Error("Installed packed artifact version does not match package.json");
  }
  const coreSmoke = await runSuccessfully(
    [
      "bun",
      "-e",
      `const seo = await import(${JSON.stringify(packageName)}); if (typeof seo.checkGraph !== "function" || typeof seo.renderSitemap !== "function" || typeof seo.documentMarkdown !== "function" || typeof seo.createMarkdownLock !== "function" || typeof seo.contentHash !== "function") throw new Error("core exports missing"); console.log("core exports ok")`,
    ],
    installDirectory,
  );
  if (!coreSmoke.includes("core exports ok")) throw new Error("Core export smoke test failed");

  await runSuccessfully(
    ["bun", "-e", `
      const m = await import("pagegraph");
      const facts = m.defineFacts({ attempts: m.fact.number(8) });
      if (m.resolveFact("attempts", facts).text !== "8") throw new Error("fact exports failed");
      const lock = m.createMarkdownLock([]);
      if (lock.version !== 1) throw new Error("markdown lock exports failed");
      const plugin = (await import("pagegraph/oxlint")).default;
      if (plugin.meta.name !== "pagegraph" || !plugin.rules["no-bare-text"] || !plugin.rules["t-children"]) throw new Error("oxlint exports failed");
    `],
    installDirectory,
  );

  const executable = path.join(installDirectory, "node_modules", ".bin", "pagegraph");
  // The packed bin must run without PageGraph's optional Effect peers. Its own
  // Effect/Jev and Pi runtimes are bundled.
  const bundledBin = await runSuccessfully([executable, "--help"], installDirectory);
  if (!bundledBin.includes("pagegraph <subcommand>")) {
    throw new Error("Packed pagegraph bin did not run standalone (Effect must be bundled)");
  }
  if (included.has("skill-data/core/SKILL.md")) {
    throw new Error("Skill source must be embedded in the CLI, not shipped as a separate runtime file");
  }
  const packedSkill = await runSuccessfully(
    [executable, "skills", "get", "core"],
    installDirectory,
  );
  if (!packedSkill.startsWith("---\nname: core\n") || !packedSkill.includes("# Pagegraph and TanStack Start")) {
    throw new Error("Packed Pagegraph CLI did not serve its embedded integration skill");
  }

  await runSuccessfully(
    [
      "npm",
      "install",
      "--no-save",
      "--ignore-scripts",
      `effect@${manifest.devDependencies.effect}`,
      `@effect/platform-bun@${manifest.devDependencies["@effect/platform-bun"]}`,
      `@effect/platform-node-shared@${manifest.devDependencies["@effect/platform-bun"]}`,
      `react@${manifest.devDependencies.react}`,
      `react-dom@${manifest.devDependencies["react-dom"]}`,
      `@tanstack/react-start@${manifest.devDependencies["@tanstack/react-start"]}`,
      `vite@${manifest.devDependencies.vite}`,
    ],
    installDirectory,
  );

  await runSuccessfully(
    ["bun", "-e", `
      const m = await import("pagegraph/claims");
      for (const name of ["claimsFamily", "claimsInputs", "resolveClaimsDocuments", "claimsRunOptions", "runClaims", "replayClaims"]) {
        if (typeof m[name] !== "function") throw new Error("Claims export missing: " + name);
      }
      if (!m.claimsInput) throw new Error("Claims input schema missing");
    `],
    installDirectory,
  );

  const publicExports = await runSuccessfully(
    [
      "bun",
      "-e",
      `await Promise.all([import(${JSON.stringify(packageName)}), import(${JSON.stringify(`${packageName}/react`)}), import(${JSON.stringify(`${packageName}/vite`)}), import(${JSON.stringify(`${packageName}/config`)}), import(${JSON.stringify(`${packageName}/audit`)}), import(${JSON.stringify(`${packageName}/claims`)}), import(${JSON.stringify(`${packageName}/tanstack-start`)})]); console.log("public exports ok")`,
    ],
    installDirectory,
  );
  if (!publicExports.includes("public exports ok")) {
    throw new Error("Public export import smoke test failed");
  }

  await runSuccessfully(
    ["bun", "-e", `
      const m = await import("pagegraph/react");
      for (const name of ["DocumentProvider", "T", "Title", "Section", "Fact", "Visual", "ForAgents", "ForHumans", "messageText", "CaptureAnchor", "createCollector", "finishDocument", "useCapturePage"]) {
        if (typeof m[name] !== "function") throw new Error("React authored export missing: " + name);
      }
      if (!m.CaptureRequest || typeof m.Section.Item.Link !== "function") throw new Error("React capture exports missing");
    `],
    installDirectory,
  );

  await runSuccessfully(
    ["bun", "-e", `
      import { mock } from "bun:test";
      mock.module("virtual:pagegraph/runtime", () => ({ graph: null, site: null, markdown: null, facts: undefined }));
      const { markdownRequest } = await import("pagegraph/tanstack-start/markdown");
      const savedProcess = globalThis.process;
      const requests = ["/pricing.md", "/__pagegraph/markdown.json", "/pricing.document.json"]
        .map(path => new Request("https://example.com" + path));
      let pending;
      try {
        globalThis.process = undefined;
        pending = requests.map(request => markdownRequest(request));
      } finally {
        globalThis.process = savedProcess;
      }
      const responses = await Promise.all(pending);
      if (responses[0] !== null || responses[1]?.status !== 404 || responses[2]?.status !== 404)
        throw new Error("Capture gating failed without Node compatibility");
    `],
    installDirectory,
  );

  const help = await runSuccessfully([executable, "--help"], installDirectory);
  if (!help.includes("pagegraph <subcommand>") || !help.includes("audit") || !help.includes("diff") || !help.includes("check") || !help.includes("sitemap")) {
    throw new Error("Packed pagegraph bin did not print the expected command tree");
  }
  const version = await runSuccessfully([executable, "--version"], installDirectory);
  const expectedVersion = `pagegraph v${manifest.version}`;
  if (version.trim() !== expectedVersion) {
    throw new Error(`Packed pagegraph bin reported ${version.trim()}, expected ${expectedVersion}`);
  }

  await Bun.write(
    path.join(installDirectory, "pagegraph.config.mjs"),
    `import { defineSeoConfig } from ${JSON.stringify(`${packageName}/config`)};\n\nexport default defineSeoConfig({\n  loadGraph: async () => ({\n    graph: {\n      nodes: new Map([["/", { path: "/", kind: "page", source: "route", policy: { kind: "page" } }]]),\n      edges: [],\n    },\n    site: { origin: "https://example.com", indexable: true, robots: { disallow: [] } },\n    dispose: async () => {},\n  }),\n});\n`,
  );
  const checkOutput = await runSuccessfully([executable, "check", "--json"], installDirectory);
  const check = JSON.parse(checkOutput) as { readonly ok?: unknown; readonly structural?: unknown };
  if (check.ok !== true || check.structural !== 0) {
    throw new Error("Packed pagegraph check did not validate the representative consumer config");
  }

  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n");
      if (url.pathname === "/sitemap.xml") {
        return new Response("<urlset/>", { headers: { "content-type": "application/xml" } });
      }
      if (url.pathname === "/llms.txt") return new Response("# Fixture\n");
      return new Response(
        `<!doctype html><title>Representative packed audit fixture</title><meta name="description" content="A representative packed audit fixture with enough descriptive content for deterministic release validation."><link rel="canonical" href="${url.origin}/"><h1>Representative packed audit fixture</h1>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  try {
    const auditOutput = await runSuccessfully(
      [executable, "audit", fixture.url.href, "--allow-private", "--probe-only", "--json"],
      installDirectory,
    );
    const audit = JSON.parse(auditOutput) as AuditFixtureReport;
    if (audit.schemaVersion !== 1 || audit.findings.length !== 0) {
      throw new Error("Packed pagegraph audit did not return the expected clean report");
    }

    const beforePath = path.join(installDirectory, "audit-before.json");
    const afterPath = path.join(installDirectory, "audit-after.json");
    await Bun.write(beforePath, `${JSON.stringify(audit, null, 2)}\n`);
    const after = structuredClone(audit);
    after.generatedAt = "2026-08-30T00:05:00.000Z";
    await Bun.write(afterPath, `${JSON.stringify(after, null, 2)}\n`);
    const unchangedOutput = await runSuccessfully(
      [executable, "diff", beforePath, afterPath, "--json"],
      installDirectory,
    );
    const unchanged = JSON.parse(unchangedOutput) as {
      readonly kind?: unknown;
      readonly outcome?: unknown;
    };
    if (unchanged.kind !== "audit-diff" || unchanged.outcome !== "unchanged") {
      throw new Error("Packed pagegraph diff did not ignore timestamp volatility");
    }

    const regression = structuredClone(after);
    const target = regression.targets[0];
    const result = regression.results[0];
    if (target === undefined || result === undefined) {
      throw new Error("Packed audit fixture did not contain a target and scanner result");
    }
    const finding: AuditFixtureFinding = {
      scanner: "rules",
      target,
      severity: "structural",
      rule: "release-fixture-regression",
      message: "Representative structural regression.",
    };
    result.findings.push(finding);
    regression.findings.push(finding);
    await Bun.write(afterPath, `${JSON.stringify(regression, null, 2)}\n`);
    const regressed = await run(
      [executable, "diff", beforePath, afterPath, "--json"],
      installDirectory,
    );
    if (regressed.exitCode !== 1 || !regressed.stderr.includes("1 structural")) {
      throw new Error("Packed pagegraph diff did not fail on a structural regression");
    }
    const regressedOutput = JSON.parse(regressed.stdout) as {
      readonly outcome?: unknown;
    };
    if (regressedOutput.outcome !== "regressed") {
      throw new Error("Packed pagegraph diff did not preserve JSON output on regression");
    }
  } finally {
    await fixture.stop(true);
  }

  // A Worker or browser bundle resolves build entries to a stub that names the mistake.
  for (const entry of ["vite", "config", "audit", "tanstack-start", "oxlint", "claims"]) {
    const specifier = `${packageName}/${entry}`;
    const runtime = await run(
      ["node", "--conditions=workerd", "--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`],
      installDirectory,
    );
    if (runtime.exitCode === 0 || !runtime.stderr.includes(`"${specifier}" is build-time only`)) {
      throw new Error(`${specifier} did not fail loud under the workerd condition\n${runtime.stderr}`);
    }
  }
  // The published runtime entries reach only their runtime peers.
  const runtimeImports = async (entry: string): Promise<Set<string>> => {
    const specifiers = new Set<string>();
    const seen = new Set<string>();
    const pending = [path.join(installedRoot, entry)];
    // Parse imports so bundled dependency documentation cannot look like external modules.
    const scanner = new Bun.Transpiler({ loader: "js" });
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const { path: specifier } of scanner.scan(await readFile(file, "utf8")).imports) {
        if (specifier.startsWith(".")) pending.push(path.resolve(path.dirname(file), specifier));
        else specifiers.add(specifier);
      }
    }
    return specifiers;
  };
  for (const [entry, allowed] of [
    ["dist/index.js", []],
    ["dist/react.js", ["@tanstack/react-router", "react", "react/jsx-runtime"]],
    ["dist/tanstack-start/server.js", ["virtual:pagegraph/runtime"]],
    ["dist/tanstack-start/markdown.js", ["react", "react/jsx-runtime", "react-dom/server", "@tanstack/react-router", "@tanstack/react-start/server", "@tanstack/react-router/ssr/server", "virtual:pagegraph/runtime"]],
    ["dist/tanstack-start/react.js", ["react", "react/jsx-runtime", "@tanstack/react-router"]],
    ["dist/tanstack-start/prerender-worker.js", ["virtual:pagegraph/prerender-server"]],
  ] as const) {
    const unexpected = [...(await runtimeImports(entry))].filter((specifier) => !(allowed as ReadonlyArray<string>).includes(specifier));
    if (unexpected.length > 0) throw new Error(`${entry} imports build-only modules: ${unexpected.join(", ")}`);
  }

  const core = await runSuccessfully(
    ["node", "--conditions=workerd", "--input-type=module", "-e", `const m = await import(${JSON.stringify(packageName)}); console.log(typeof m.pageHeads)`],
    installDirectory,
  );
  if (core.trim() !== "function") throw new Error("pagegraph did not load under the workerd condition");

  console.log(`Validated ${packed.filename} from an isolated temporary consumer`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
