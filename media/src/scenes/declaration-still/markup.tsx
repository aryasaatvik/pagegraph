import type { SceneMarkup } from "../../scene";
import { Code, Header, Scene } from "../parts";
import { pricingLines, pricingRoute } from "../source";

/** Each declared field, what it derives, and the check that guards it. */
export const fields = [
  {
    field: "link",
    line: pricingLines.link[0],
    derives: "The card other pages render when they list it in related.",
    guard: "A related target with no link fails.",
  },
  {
    field: "crumb",
    line: pricingLines.crumb[0],
    derives: "A crumb-parent edge to its nearest ancestor with a crumb.",
    guard: "seo.head builds its BreadcrumbList from the same crumbs.",
  },
  {
    field: "sitemap",
    line: pricingLines.sitemap[0],
    derives: "Its <loc>, <changefreq>, and <priority> in sitemap.xml.",
    guard: "A sitemap policy on a noindex page or a redirect fails.",
  },
  {
    field: "head",
    line: pricingLines.head[0],
    derives:
      "seo.head renders the title, description, Open Graph and Twitter tags, canonical link, and FAQPage JSON-LD.",
    guard: "Titles or descriptions shared across pages warn.",
  },
  {
    field: "head.image",
    line: pricingLines.head[0] + 1,
    derives: "og:image with size and alt text; a large Twitter card.",
    guard: "By default, a sitemap page without an image, or with one missing from public/, fails.",
  },
] as const;

const LINE = 32;
const CODE_TOP = 300;
const BODY = CODE_TOP + 54 + 22;

/** Infographic: one route declaration, annotated. */
export const declarationStill: SceneMarkup = {
  id: "declaration-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="One declaration" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 150, fontSize: 64, whiteSpace: "nowrap" }}
      >
        Declare once in{" "}
        <span className="pg-mono pg-lime" style={{ fontSize: 58 }}>
          staticData.seo
        </span>
      </h1>
      <p className="pg-sub pg-abs" style={{ left: 120, top: 228, fontSize: 26 }}>
        The graph, the rendered head, and the checks read the same object.
      </p>
      <Code
        code={pricingRoute.code}
        file="src/routes/(marketing)/pricing.tsx"
        fontSize={17}
        lineHeight={LINE}
        box={{ left: 120, top: CODE_TOP, width: 1000, height: 650 }}
      />
      {fields.map((field, index) => (
        <span
          key={field.field}
          className="pg-badge pg-badge--lime pg-abs"
          style={{
            left: 103,
            top: BODY + field.line * LINE + LINE / 2 - 17,
            height: 34,
            width: 34,
            padding: 0,
            justifyContent: "center",
            borderRadius: 17,
          }}
        >
          {index + 1}
        </span>
      ))}
      <ol
        className="pg-abs"
        style={{
          left: 1170,
          top: CODE_TOP,
          width: 630,
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {fields.map((field, index) => (
          <li key={field.field} style={{ display: "flex", gap: 18 }}>
            <span
              className="pg-badge pg-badge--lime"
              style={{
                height: 34,
                minWidth: 34,
                padding: 0,
                justifyContent: "center",
                borderRadius: 17,
              }}
            >
              {index + 1}
            </span>
            <div>
              <div className="pg-mono pg-lime" style={{ fontSize: 23, fontWeight: 600 }}>
                {field.field}
              </div>
              <div style={{ fontSize: 22, lineHeight: 1.3, marginTop: 4 }}>{field.derives}</div>
              <div className="pg-soft" style={{ fontSize: 18, lineHeight: 1.3, marginTop: 4 }}>
                {field.guard}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="pg-note pg-abs" style={{ left: 120, top: 984, margin: 0 }}>
        From tests/fixtures/tanstack-start-app. The media tests re-derive its head and sitemap
        output.
      </p>
    </Scene>
  ),
};
