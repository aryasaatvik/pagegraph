import { visibleStrings } from "./strings";

/** Prints every visible text node per scene for a frame-by-frame claim audit. */
for (const [scene, strings] of visibleStrings()) console.log(JSON.stringify({ scene, strings }));
