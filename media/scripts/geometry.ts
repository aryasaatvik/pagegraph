import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { renderToStaticMarkup } from "react-dom/server";
import type { Size } from "../src/scene";
import { markups } from "../src/scenes/markup";
import { app } from "./projects";

/** A scene as Chrome laid it out. */
export interface Layout {
  readonly lines: ReadonlyArray<TextLine>;
  /** The right edge of the layout frame: the header rule when the scene has one, else the canvas. */
  readonly frame: number;
  /** Elements that hide overflow and whose content is wider or taller than their box. */
  readonly clipped: ReadonlyArray<{ readonly element: string; readonly overflow: number }>;
}

/** One laid-out line of text, as Chrome placed its glyphs. */
export interface TextLine {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** The content box of the nearest block that should contain the line. */
  readonly box: { readonly left: number; readonly right: number };
}

const fonts = {
  "bricolage-grotesque.woff2":
    "node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2",
  "spline-sans-mono.woff2":
    "node_modules/@fontsource-variable/spline-sans-mono/files/spline-sans-mono-latin-wght-normal.woff2",
} as const;

/**
 * Runs in the page: every text line in the scene with its glyph box and the content box of the
 * block it belongs to, the frame's right edge, and any element clipping its content. Static markup
 * is the settled layout of the stills (their motion is empty).
 */
const MEASURE = `(async () => {
  await document.fonts.ready;
  const loaded = ["Bricolage Grotesque", "Spline Sans Mono"].every((family) =>
    [...document.fonts].some((face) => face.family.replace(/"/g, "") === family && face.status === "loaded"));
  if (!loaded) throw new Error("bundled fonts did not load");
  const scene = document.querySelector(".pg-scene");
  const origin = scene.getBoundingClientRect();
  const lines = [];
  const walker = document.createTreeWalker(scene, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    let block = node.parentElement;
    while (getComputedStyle(block).display.startsWith("inline") && block !== scene) block = block.parentElement;
    const style = getComputedStyle(block);
    const outer = block.getBoundingClientRect();
    const box = {
      left: outer.left - origin.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: outer.right - origin.left - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    };
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      lines.push({
        text: node.textContent.trim().slice(0, 48),
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        top: rect.top - origin.top,
        bottom: rect.bottom - origin.top,
        box,
      });
    }
  }
  const header = scene.querySelector(".pg-header");
  const frame = header ? header.getBoundingClientRect().right - origin.left : origin.width;
  const clipped = [];
  for (const element of [scene, ...scene.querySelectorAll("*")]) {
    const style = getComputedStyle(element);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const overflow = Math.max(element.scrollWidth - element.clientWidth, element.scrollHeight - element.clientHeight);
    if (overflow > 1) clipped.push({ element: element.className || element.tagName, overflow });
  }
  return { lines, frame, clipped };
})()`;

/** A Chrome installed on the system, if any. */
async function systemChrome(): Promise<string | undefined> {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (await Bun.file(mac).exists()) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const path = Bun.which(name);
    if (path) return path;
  }
  return undefined;
}

/**
 * The Chrome HyperFrames renders with, else a system Chrome; `CHROME_PATH` overrides both. The
 * HyperFrames cache is absent until `hyperframes browser ensure` or a render has run, as on a
 * fresh CI runner.
 */
export async function findChrome({
  env = process.env,
  cache = join(homedir(), ".cache/hyperframes/chrome"),
  system = systemChrome,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  cache?: string;
  system?: () => Promise<string | undefined>;
} = {}): Promise<string> {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const managed = new Bun.Glob("chrome-headless-shell/*/*/chrome-headless-shell");
  if (existsSync(cache))
    for await (const path of managed.scan({ cwd: cache, absolute: true, onlyFiles: true }))
      return path;
  const path = await system();
  if (path !== undefined) return path;
  throw new Error(
    "no Chrome to measure layout with: run `bunx hyperframes browser ensure` or set CHROME_PATH",
  );
}

/** `promise`, or a rejection naming `what` if it has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not open within ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** The DevTools address Chrome prints once it is ready, or its log when it exits first. */
async function devtoolsAddress(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let log = "";
  for await (const chunk of stderr) {
    log += decoder.decode(chunk);
    const port = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(log)?.[1];
    if (port !== undefined) return `127.0.0.1:${port}`;
  }
  throw new Error(`Chrome exited before DevTools was ready:\n${log}`);
}

/**
 * A headless Chrome serving each scene's static markup with the bundled stylesheet and fonts. A
 * Chrome that fails to start, or does not open DevTools within `startupTimeout` ms, rejects after
 * its process, server, and profile are released.
 */
export async function openBrowser({ startupTimeout = 20_000 }: { startupTimeout?: number } = {}) {
  const executable = await findChrome();
  const stylesheet = await readFile(join(app, "src/styles.css"), "utf8");
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const font = url.pathname.match(/^\/fonts\/([\w-]+\.woff2)$/)?.[1];
      if (font !== undefined && font in fonts)
        return new Response(Bun.file(join(app, fonts[font as keyof typeof fonts])));
      const scene = markups[url.searchParams.get("scene") ?? ""];
      if (scene === undefined) return new Response("not found", { status: 404 });
      const size = {
        width: Number(url.searchParams.get("width")),
        height: Number(url.searchParams.get("height")),
      };
      return new Response(
        `<!doctype html><html><head><meta charset="UTF-8"><style>${stylesheet}</style></head>` +
          `<body>${renderToStaticMarkup(scene.render(size))}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  let profile: string | undefined;
  let child: Subprocess<"ignore", "ignore", "pipe"> | undefined;
  const close = async () => {
    child?.kill();
    await child?.exited;
    await server.stop(true);
    if (profile !== undefined) await rm(profile, { recursive: true, force: true });
  };
  let devtools: string;
  try {
    profile = await mkdtemp(join(tmpdir(), "pagegraph-media-chrome-"));
    child = Bun.spawn(
      [
        executable,
        "--headless",
        "--disable-gpu",
        // Hosted Linux runners restrict the namespaces Chrome's sandbox needs; the page is our own.
        ...(process.env.CI ? ["--no-sandbox"] : []),
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
    );
    devtools = await within(
      devtoolsAddress(child.stderr),
      startupTimeout,
      "Chrome's DevTools endpoint",
    );
  } catch (cause) {
    await close();
    throw cause;
  }

  return {
    /** `scene` laid out at `size`. */
    async layout(scene: string, size: Size): Promise<Layout> {
      const page = `http://localhost:${server.port}/?scene=${scene}&width=${size.width}&height=${size.height}`;
      const target = (await (
        await fetch(`http://${devtools}/json/new?${encodeURIComponent(page)}`, { method: "PUT" })
      ).json()) as { id: string; webSocketDebuggerUrl: string };
      try {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener("open", resolve, { once: true });
          socket.addEventListener("error", reject, { once: true });
        });
        const call = (id: number, method: string, params: object) =>
          new Promise<{ result: { result: { value: unknown }; exceptionDetails?: unknown } }>(
            (resolve) => {
              socket.addEventListener("message", function reply(event) {
                const message = JSON.parse(String(event.data)) as { id?: number };
                if (message.id !== id) return;
                socket.removeEventListener("message", reply);
                resolve(message as never);
              });
              socket.send(JSON.stringify({ id, method, params }));
            },
          );
        await call(1, "Emulation.setDeviceMetricsOverride", {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        // The page may still be loading; wait for its markup before measuring.
        await call(2, "Runtime.evaluate", {
          expression: `new Promise((done) => document.readyState === "complete" && document.querySelector(".pg-scene") ? done() : addEventListener("load", () => done()))`,
          awaitPromise: true,
        });
        const { result } = await call(3, "Runtime.evaluate", {
          expression: MEASURE,
          awaitPromise: true,
          returnByValue: true,
        });
        socket.close();
        if (result.exceptionDetails !== undefined)
          throw new Error(`measuring ${scene} failed: ${JSON.stringify(result.exceptionDetails)}`);
        return result.result.value as Layout;
      } finally {
        await fetch(`http://${devtools}/json/close/${target.id}`);
      }
    },
    close,
  };
}
