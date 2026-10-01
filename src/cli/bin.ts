#!/usr/bin/env bun
/**
 * The `pagegraph` bin.
 *
 * Effect and `@effect/platform-bun` are bundled into this entry, so the published
 * binary is self-contained: it does not ask the consumer to install optional
 * Effect peers or resolve a different Effect version from the consumer's tree.
 *
 * The library entries (`.`, `./react`, `./vite`, `./config`) stay Effect-free, so a
 * consumer that only declares SEO on routes never installs Effect. `./audit` and
 * this CLI are where Effect is reached.
 */
import { run } from "./main";

run();

export {};
