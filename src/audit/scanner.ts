import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { AuditFinding, AuditOptions, AuditTarget, ScannerId } from "./model";

/** A typed, attributed failure from a scanner. The audit service catches this
 * at the scanner boundary and preserves it in the report. */
export class ScannerFailure extends Data.TaggedError("ScannerFailure")<{
  readonly scanner: ScannerId;
  readonly target: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ScannerInput {
  readonly target: AuditTarget;
  readonly options: AuditOptions;
}

export interface ScannerObservation {
  readonly evidence?: unknown;
  readonly findings?: readonly AuditFinding[];
}

export interface ScannerRule {
  readonly id: string;
  readonly evaluate: (
    observation: ScannerObservation,
    input: ScannerInput,
  ) => readonly AuditFinding[];
}

/** Value-level scanner protocol. Concrete adapters remain ordinary values and
 * can be substituted in tests or composed into a registry layer. */
export interface Scanner {
  readonly id: ScannerId;
  readonly description?: string;
  readonly rules?: readonly ScannerRule[];
  readonly scan: (input: ScannerInput) => Effect.Effect<ScannerObservation, ScannerFailure>;
}

export const scanner = (definition: Scanner): Scanner => definition;
