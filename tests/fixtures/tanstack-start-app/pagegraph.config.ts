import { defineSeoConfig } from "../../../src/config/index";
import { tanstackStartGraph } from "../../../src/tanstack-start/index";

export default defineSeoConfig({
  loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
});
