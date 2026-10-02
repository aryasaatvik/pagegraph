import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const SDK_VERSION = "2.0.22";
const EFFECT_VERSION = "4.0.0-rc.112";
const CACHE_REVISION = "2";
const CLIENT_CHUNK = "node_modules/@opencode/client/dist/chunks/service-contender-50fct660.js";
const SDK_ENTRY = "node_modules/@opencode/sdk/dist/index.js";
const execFileAsync = promisify(execFile);
const installations = new Map<string, Promise<string>>();

const manifest = JSON.stringify({
  name: "pagegraph-opencode-runtime",
  private: true,
  type: "module",
  dependencies: { "@opencode/sdk": SDK_VERSION },
  // OpenCode's platform dependency uses a prerelease range that also accepts stable v4.
  overrides: { effect: EFFECT_VERSION, "@effect/platform-node-shared": EFFECT_VERSION },
}, null, 2);

const originalResponseError = `  const responseError = async (response, descriptor) => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared(await json(response));
    try {
      await response.body?.cancel();
    } catch {}
    throw new ClientError3("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) });
  };`;

// The pinned client's public API discards undeclared HTTP error bodies and exposes no fetch hook.
// Retain context on both declared and undeclared HTTP errors before publishing the runtime.
const retainedResponseError = `  const responseError = async (response, descriptor) => {
    if (descriptor.declaredStatuses.includes(response.status)) {
      const body = await json(response);
      const error = declared(body);
      error.cause = { status: response.status, method: descriptor.method, path: descriptor.path, body };
      throw error;
    }
    let body = "";
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let remaining = 16384;
      try {
        while (remaining > 0) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const bytes = chunk.value.subarray(0, remaining);
          body += decoder.decode(bytes, { stream: true });
          remaining -= bytes.byteLength;
        }
        body += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    throw new ClientError3("UnexpectedStatus", {
      cause: { status: response.status, method: descriptor.method, path: descriptor.path, body },
      detail: String(response.status)
    });
  };`;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readManifest = async (file: string): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!record(value)) throw new Error(`Invalid OpenCode runtime package manifest: ${file}`);
  return value;
};

const verifyPackages = async (directory: string): Promise<void> => {
  const hostEffect = await realpath(join(directory, "node_modules/effect/package.json"));
  const sdk = await readManifest(join(directory, "node_modules/@opencode/sdk/package.json"));
  if (sdk.version !== SDK_VERSION) throw new Error(`OpenCode runtime requires SDK ${SDK_VERSION}.`);
  for (const name of ["sdk", "core", "plugin", "server", "util"]) {
    const file = join(directory, `node_modules/@opencode/${name}/package.json`);
    const dependency = await readManifest(file);
    if (dependency.version !== SDK_VERSION) throw new Error(`Unexpected @opencode/${name} runtime version.`);
    const require = createRequire(file);
    const effect = await readManifest(require.resolve("effect/package.json"));
    if (effect.version !== EFFECT_VERSION) throw new Error(`@opencode/${name} requires Effect ${EFFECT_VERSION}.`);
    if (await realpath(require.resolve("effect/package.json")) !== hostEffect) {
      throw new Error(`@opencode/${name} does not share the isolated host's Effect installation.`);
    }
    if (name === "core" || name === "server") {
      const dependencies = dependency.dependencies;
      const drizzle = await readManifest(require.resolve("drizzle-orm/package.json"));
      if (!record(dependencies) || drizzle.version !== dependencies["drizzle-orm"]) {
        throw new Error(`@opencode/${name} has a different Drizzle version from its declared dependency.`);
      }
    }
  }
  const shared = await readManifest(join(directory, "node_modules/@effect/platform-node-shared/package.json"));
  if (shared.version !== EFFECT_VERSION) throw new Error(`OpenCode runtime requires platform-node-shared ${EFFECT_VERSION}.`);
  await access(join(directory, SDK_ENTRY));
};

const stamp = (client: string): string =>
  `${SDK_VERSION}:${EFFECT_VERSION}:${CACHE_REVISION}:${createHash("sha256").update(client).digest("hex")}`;

const cacheExists = async (directory: string): Promise<boolean> => {
  try {
    await access(directory);
    return true;
  } catch (cause) {
    if (record(cause) && cause.code === "ENOENT") return false;
    throw cause;
  }
};

const verifyCache = async (directory: string): Promise<void> => {
  await verifyPackages(directory);
  const client = await readFile(join(directory, CLIENT_CHUNK), "utf8");
  if (!client.includes(retainedResponseError) || await readFile(join(directory, ".ready"), "utf8") !== stamp(client)) {
    throw new Error(`The isolated OpenCode runtime cache is incomplete or changed: ${directory}. Remove this directory and retry.`);
  }
};

const installOutput = (cause: unknown): string => {
  if (!record(cause)) return String(cause);
  const code = typeof cause.code === "string" || typeof cause.code === "number" ? `Installer exit: ${cause.code}.` : "";
  const signal = typeof cause.signal === "string" ? `Installer signal: ${cause.signal}.` : "";
  return [code, signal, cause.stderr, cause.stdout].filter((value): value is string => typeof value === "string")
    .join("\n").slice(-4000)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
    .replace(/((?:token|password|_auth|authorization)[=:]\s*)[^\s]+/gi, "$1[redacted]");
};

export interface WorkflowRuntimeOptions {
  readonly cacheDirectory?: string;
  readonly bunExecutable?: string;
}

const installRuntime = async (directory: string, bunExecutable: string): Promise<string> => {
  if (await cacheExists(directory)) {
    await verifyCache(directory);
    return join(directory, SDK_ENTRY);
  }
  await mkdir(resolve(directory, ".."), { recursive: true });
  // Installing outside the consumer's ancestry prevents Bun from discovering its workspace overrides.
  const temporary = await mkdtemp(join(tmpdir(), "pagegraph-opencode-"));
  let publication: string | undefined;
  try {
    await writeFile(join(temporary, "package.json"), manifest);
    await writeFile(join(temporary, "bunfig.toml"), "[install]\n");
    try {
      await execFileAsync(bunExecutable, [
        "install", `--config=${join(temporary, "bunfig.toml")}`,
        "--registry=https://registry.npmjs.org", "--ignore-scripts", "--linker=hoisted",
      ], {
        cwd: temporary,
        // Consumer package-manager settings and registry credentials must not affect this public install.
        env: { PATH: process.env.PATH, TMPDIR: tmpdir(), SystemRoot: process.env.SystemRoot },
        timeout: 240_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (cause) {
      throw new Error(`Could not install isolated OpenCode SDK ${SDK_VERSION} with ${bunExecutable}.\n${installOutput(cause)}`);
    }
    await verifyPackages(temporary);
    const clientFile = join(temporary, CLIENT_CHUNK);
    const client = await readFile(clientFile, "utf8");
    if (client.split(originalResponseError).length !== 2) {
      throw new Error(`OpenCode SDK ${SDK_VERSION} client does not match the expected HTTP diagnostics patch.`);
    }
    const patched = client.replace(originalResponseError, retainedResponseError);
    // Replace rather than overwrite Bun's cache-backed file, preserving cached upstream packages.
    await writeFile(`${clientFile}.pagegraph`, patched);
    await rename(`${clientFile}.pagegraph`, clientFile);
    await writeFile(join(temporary, ".ready"), stamp(patched));
    await verifyCache(temporary);
    try {
      await rename(temporary, directory);
    } catch (cause) {
      if (await cacheExists(directory)) {
        // A concurrent process may have published first; use it only after the same validation.
        await verifyCache(directory);
      } else if (record(cause) && cause.code === "EXDEV") {
        // A copy on the cache's filesystem preserves atomic publication across different devices.
        publication = await mkdtemp(`${directory}.installing-`);
        await cp(temporary, publication, { recursive: true, dereference: true });
        try {
          await rename(publication, directory);
          publication = undefined;
        } catch (publicationCause) {
          if (!await cacheExists(directory)) throw publicationCause;
          await verifyCache(directory);
        }
      } else {
        throw cause;
      }
    }
    return join(directory, SDK_ENTRY);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (publication !== undefined) await rm(publication, { recursive: true, force: true });
  }
};

export const ensureWorkflowRuntime = (options: WorkflowRuntimeOptions = {}): Promise<string> => {
  const directory = resolve(options.cacheDirectory ?? join(
    homedir(), ".cache", "pagegraph", `opencode-${SDK_VERSION}-${CACHE_REVISION}`,
  ));
  const pending = installations.get(directory);
  if (pending !== undefined) return pending;
  const installation = installRuntime(directory, options.bunExecutable ?? (
    basename(process.execPath).startsWith("bun") ? process.execPath : "bun"
  )).finally(() => installations.delete(directory));
  installations.set(directory, installation);
  return installation;
};

export const loadWorkflowOpenCode = async (): Promise<typeof import("@opencode/sdk")> => {
  const entry = await ensureWorkflowRuntime();
  try {
    return await import(pathToFileURL(entry).href);
  } catch (cause) {
    throw new Error(`Could not load the isolated OpenCode runtime at ${entry}.`, { cause });
  }
};
