import { createLink, Link as RouterLink } from "@tanstack/react-router";
import type { LinkComponent } from "@tanstack/react-router";

import { CaptureAnchor, useCapturePage } from "../react/document";

const CapturedLink = createLink(CaptureAnchor);

/** Router Link with authored destination capture inside DocumentProvider. */
export const Link: LinkComponent<typeof CaptureAnchor> = (props) => {
  const page = useCapturePage();
  return page === undefined ? <RouterLink {...props} /> : <CapturedLink {...props} />;
};
