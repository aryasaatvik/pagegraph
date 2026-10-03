import noBareText from "./no-bare-text.js";
import tChildren from "./t-children.js";

export default {
  meta: { name: "pagegraph" },
  rules: { "no-bare-text": noBareText, "t-children": tChildren },
};
