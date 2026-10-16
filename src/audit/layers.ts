import * as Layer from "effect/Layer";

import { Audit, AuditLive } from "./audit";
import { ScannerRegistry, ScannerRegistryLive } from "./scanner-registry";
import type { Scanner } from "./scanner";

/** Compose the default audit services with an explicit scanner set. */
export const AuditLayer = (scanners: Iterable<Scanner>): Layer.Layer<Audit.Service> =>
  AuditLive.pipe(Layer.provide(ScannerRegistryLive(scanners)));

export { Audit, ScannerRegistry };
export { AuditLive };
