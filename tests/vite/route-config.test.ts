import type { RouteNode } from "@tanstack/router-generator";
import { describe, expect, it } from "vitest";

import { deriveRouteConfig, resolveOptions } from "../../src/vite/route-config";

const page = (group: string, routePath: string): RouteNode =>
  ({
    filePath: `${group}/${routePath.slice(1).replace(/\/\$?/g, ".")}.tsx`,
    routePath: `/${group}${routePath}`,
  }) as unknown as RouteNode;

const exclusions = (routes: ReadonlyArray<string>, alwaysDisallow: ReadonlyArray<string> = []) =>
  deriveRouteConfig(
    routes.map((route) => page("(forms)", route)),
    resolveOptions({
      outputPath: "/unused",
      publicGroups: ["(forms)"],
      enforceCoverageIn: [],
      disallowGroups: ["(forms)"],
      alwaysDisallow,
    }),
  ).robotsExclusions;

describe("robotsExclusions", () => {
  it("keeps the trailing slash where a dynamic segment was stripped", () => {
    expect(exclusions(["/s/$formKey"])).toEqual(["/s/"]);
  });

  it("leaves static leaves unchanged", () => {
    expect(exclusions(["/signup", "/account/billing"])).toEqual(["/account/billing", "/signup"]);
  });

  it("keeps a static parent page beside its dynamic child", () => {
    expect(exclusions(["/invite", "/invite/$token"])).toEqual(["/invite", "/invite/"]);
  });

  it("collapses nested dynamic segments to the first one", () => {
    expect(exclusions(["/o/$org/p/$project"])).toEqual(["/o/"]);
  });

  it("treats splat and optional segments as dynamic", () => {
    expect(exclusions(["/files/$", "/docs/{-$version}/intro"])).toEqual(["/docs/", "/files/"]);
  });

  it("dedupes, sorts, and passes alwaysDisallow through verbatim", () => {
    expect(exclusions(["/s/$a", "/s/$b", "/b"], ["/api", "/z/"])).toEqual([
      "/api",
      "/b",
      "/s/",
      "/z/",
    ]);
  });

  it("fails loudly for a root-level dynamic route", () => {
    expect(() => exclusions(["/$slug"])).toThrow(/cannot be disallowed in robots\.txt/);
  });
});
