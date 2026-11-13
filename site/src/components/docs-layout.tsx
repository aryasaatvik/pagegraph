import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { DocsPageData } from "../lib/docs-data";

export function DocsLayout({ data, children }: { data: DocsPageData; children: ReactNode }) {
  return (
    <div className="wrap docs">
      <nav className="docs-nav" aria-label="Docs">
        {data.nav.map((group) => (
          <div key={group.label}>
            <h2>{group.label}</h2>
            <ul>
              {group.links.map((item) => (
                <li key={item.url}>
                  <Link
                    to={item.url}
                    aria-current={item.url === data.url ? "page" : undefined}
                    activeOptions={{ exact: true }}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <article className="docs-body">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            {data.breadcrumbs.map((crumb, index) => (
              <li key={crumb.path}>
                {index === data.breadcrumbs.length - 1 ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <Link to={crumb.path}>{crumb.name}</Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <h1>{data.title}</h1>
        <p className="docs-lede">{data.description}</p>
        <div className="prose">{children}</div>
        {data.related.length > 0 && (
          <section className="next" aria-labelledby="next-h">
            <h2 id="next-h">Read next</h2>
            <ul>
              {data.related.map((item) => (
                <li key={item.url}>
                  <Link to={item.url}>
                    <b>{item.title}</b>
                    <span>{item.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="docs-meta">
          <a href={data.editUrl}>Edit this page on GitHub</a>
          <span aria-hidden="true"> · </span>
          <a href={`${data.url}.md`}>View as Markdown</a>
        </p>
      </article>
      {data.toc.length > 0 && (
        <nav className="toc" aria-label="On this page">
          <h2>On this page</h2>
          <ul>
            {data.toc.map((item) => (
              <li key={item.url} data-depth={item.depth}>
                <a href={item.url}>{item.title}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
