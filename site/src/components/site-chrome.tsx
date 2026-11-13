import { Link } from "@tanstack/react-router";

import { Mark } from "./mark";
import { ThemeToggle } from "./theme";

export const REPO_URL = "https://github.com/aryasaatvik/pagegraph";
export const NPM_URL = "https://www.npmjs.com/package/pagegraph";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="top">
      <div className="wrap">
        <Link className="brand" to="/" aria-label="PageGraph home">
          <Mark />
          pagegraph
        </Link>
        <nav aria-label="Primary">
          <Link to="/docs" activeProps={{ "aria-current": "page" }}>
            Docs
          </Link>
          <Link className="wide" to="/docs/$" params={{ _splat: "reference/cli" }}>
            CLI
          </Link>
          <Link className="wide" to="/changelog">
            Changelog
          </Link>
        </nav>
        <div className="end">
          <a className="icon" href={REPO_URL} aria-label="PageGraph on GitHub">
            <GitHubIcon />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>
          MIT license. Made by <a href="https://arya.sh">Saatvik Arya</a>.
        </span>
        <nav aria-label="Footer">
          <Link to="/docs">Docs</Link>
          <Link to="/changelog">Changelog</Link>
          <a href={REPO_URL}>GitHub</a>
          <a href={NPM_URL}>npm</a>
          <a href="/sitemap.xml">Sitemap</a>
        </nav>
        <p className="family">
          More from Arya Labs: <a href="https://domain-kit.dev">DomainKit</a>
          <span aria-hidden="true">·</span>
          <a href="https://capsuledb.arya.sh">CapsuleDB</a>
          <span aria-hidden="true">·</span>
          <a href="https://aryalabs.ai">aryalabs.ai</a>
        </p>
      </div>
    </footer>
  );
}
