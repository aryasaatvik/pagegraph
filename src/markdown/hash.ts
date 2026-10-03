// Explicit installed-file imports keep source entry checks aligned with the bundled library.
import { sha256 } from "../../node_modules/@noble/hashes/sha2.js";
import { bytesToHex } from "../../node_modules/@noble/hashes/utils.js";

/** Key order is not content; array order is. Reject values JSON cannot represent. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error(`Document content is not JSON: ${String(value)}`);
}

export const contentHash = (value: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(stableJson(value))));
