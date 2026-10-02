import * as Schema from "effect/Schema";

import { metaFamily, MetaInput } from "../../decide/families/meta";
import { defineWorkflow } from "./types";

const MetadataState = Schema.Struct({
  summary: Schema.String,
  items: Schema.Array(MetaInput),
});

export const metadataWorkflow = defineWorkflow({
  id: "improve.metadata",
  skills: ["metadata-improvement"],
  mutatesFiles: true,
  stateSchema: MetadataState,
  decisionInputs: (state) => state.items,
  family: metaFamily,
  researchInstructions:
    "Inspect route intent and current head metadata using repository and live provider evidence. For every proposed improvement, draft at least two distinct title/description candidates with unique ids so the decision step can rank them. Retain the current metadata as a candidate when it remains truthful. Return an empty items array when evidence supports no improvement.",
  actionInstructions:
    "Apply the selected metadata candidate to the owning route or Fumadocs source, preserve truthful claims, and leave the diff uncommitted.",
});
