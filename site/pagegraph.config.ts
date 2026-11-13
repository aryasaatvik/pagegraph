import { defineSeoConfig } from "pagegraph/config";
import { tanstackStartGraph } from "pagegraph/tanstack-start";

export default defineSeoConfig({
  loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
});
