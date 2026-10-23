import type { CSSProperties, ReactNode } from "react";
import type { Size } from "../scene";

/**
 * Primitives shared by the film, the infographics, and the cards. Styling lives in
 * `src/styles.css`; `data-a="<name>"` marks what a motion animates.
 */

/** Spline Sans Mono advances every glyph 1200 of 2000 units: 0.6em. */
export const MONO_ADVANCE = 0.6;

/** The mark: one declared node (lime) feeding two derived nodes (ink outline). */
export function Mark({ height, a }: { height: number; a?: string }) {
  const part = (name: string) => (a === undefined ? undefined : `${a}-${name}`);
  return (
    <svg
      data-a={a}
      width={(height * 40) / 32}
      height={height}
      viewBox="0 0 40 32"
      fill="none"
      style={{ display: "block", flexShrink: 0, overflow: "visible" }}
    >
      <path
        data-a={part("edge")}
        d="M12 16H20V6H28M20 16V26H28"
        stroke="var(--pg-ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        pathLength={1}
      />
      <rect data-a={part("root")} x="1" y="10" width="12" height="12" fill="var(--pg-lime)" />
      <rect
        data-a={part("leaf")}
        x="28.25"
        y="1.25"
        width="9.5"
        height="9.5"
        stroke="var(--pg-ink)"
        strokeWidth="2.5"
      />
      <rect
        data-a={part("leaf")}
        x="28.25"
        y="21.25"
        width="9.5"
        height="9.5"
        stroke="var(--pg-ink)"
        strokeWidth="2.5"
      />
    </svg>
  );
}

/** The wordmark: the package name, set in the display face. */
export function Wordmark({ size, a }: { size: number; a?: string }) {
  return (
    <span
      data-a={a}
      className="pg-h"
      style={{ fontSize: size, fontWeight: 680, fontStretch: "92%", letterSpacing: "-0.025em" }}
    >
      pagegraph
    </span>
  );
}

export function Scene({ size, children }: { size: Size; children: ReactNode }) {
  return (
    <div className="pg-scene" style={{ width: size.width, height: size.height }}>
      <i className="pg-grid" />
      {children}
    </div>
  );
}

/** Brand left, chapter right, a rule beneath. */
export function Header({ chapter }: { chapter: string }) {
  return (
    <header className="pg-header" data-a="header">
      <span className="pg-brand">
        <Mark height={26} />
        <span>pagegraph</span>
      </span>
      <span className="pg-kicker">{chapter}</span>
    </header>
  );
}

export function Kicker({
  children,
  a,
  lime,
  style,
}: {
  children: ReactNode;
  a?: string;
  lime?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={lime ? "pg-kicker pg-kicker--lime" : "pg-kicker"} style={style}>
      {children}
    </span>
  );
}

/** One line of display type that rises out of its mask; the mask clips it by design. */
export function Line({ children, a = "line" }: { children: ReactNode; a?: string }) {
  return (
    <span className="pg-mask" data-layout-allow-overflow="">
      <span data-a={a}>{children}</span>
    </span>
  );
}

/* Icons: the bundled faces lack these glyphs, so they are drawn. ---------------------------- */

export function Arrow({ size = 28, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0, color: color ?? "currentColor" }}
    >
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
      />
    </svg>
  );
}

/** The terminal's ✗, one monospace cell wide. */
export function Cross({ size, color = "var(--pg-coral)" }: { size: number; color?: string }) {
  return (
    <svg
      width={size * MONO_ADVANCE}
      height={size}
      viewBox="0 0 12 20"
      fill="none"
      style={{ display: "inline-block", verticalAlign: "-0.14em", color }}
    >
      <path d="M2 5l8 10M10 5l-8 10" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

export function Check({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

/* Code ------------------------------------------------------------------------------------- */

const TOKEN =
  /("[^"]*"|`[^`]*`|<\/?[A-Za-z][\w.]*|\/?>|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|const|return)\b|[A-Za-z_$][\w$]*|\s+|.)/g;

function tokenClass(token: string): string | undefined {
  if (token.startsWith('"') || token.startsWith("`")) return "tk-str";
  if (/^<\/?[A-Za-z]/.test(token) || token === ">" || token === "/>") return "tk-tag";
  if (/^\d/.test(token)) return "tk-num";
  if (/^(?:import|from|export|const|return)$/.test(token)) return "tk-kw";
  return undefined;
}

/** Syntax-colored spans for one line of TypeScript or TSX. */
export function highlightLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let index = 0;
  for (const match of line.matchAll(TOKEN)) {
    const token = match[0];
    const end = (match.index ?? 0) + token.length;
    const isKey = /^[A-Za-z_$][\w$]*$/.test(token) && (line[end] === ":" || line[end] === "=");
    const className = isKey ? "tk-key" : tokenClass(token);
    parts.push(
      className === undefined ? (
        token
      ) : (
        <span key={index} className={className}>
          {token}
        </span>
      ),
    );
    index += 1;
  }
  return parts;
}

export interface CodeHighlight {
  readonly a: string;
  /** First and last highlighted line, zero-based and inclusive. */
  readonly from: number;
  readonly to: number;
  readonly tone?: "lime" | "coral";
}

/** Horizontal padding of a code line and a terminal body, each side. */
export const CODE_PAD = 28;
/** File header height plus the body's vertical padding. */
export const CODE_CHROME = 54 + 44;

/** A code panel at an explicit box. `data-cols`/`data-font` let the layout test bound its lines. */
export function Code({
  code,
  file,
  fontSize,
  lineHeight,
  box,
  highlights = [],
  a = "code",
}: {
  code: string;
  file: string;
  fontSize: number;
  lineHeight: number;
  box: { left: number; top: number; width: number; height: number };
  highlights?: ReadonlyArray<CodeHighlight>;
  a?: string;
}) {
  const lines = code.split("\n");
  return (
    <div
      className="pg-code"
      data-a={a}
      data-cols={Math.max(...lines.map((line) => line.length))}
      data-rows={lines.length}
      data-font={fontSize}
      data-line={lineHeight}
      style={box}
    >
      <div className="pg-code-file">
        <i />
        {file}
      </div>
      <div className="pg-code-body" style={{ fontSize, lineHeight: `${lineHeight}px` }}>
        {highlights.map((highlight) => (
          <i
            key={`${highlight.a}-${highlight.from}`}
            data-a={highlight.a}
            className={highlight.tone === "coral" ? "pg-code-hi pg-code-hi--coral" : "pg-code-hi"}
            style={{
              top: 22 + highlight.from * lineHeight,
              height: (highlight.to - highlight.from + 1) * lineHeight,
            }}
          />
        ))}
        {lines.map((line, index) => (
          <div key={index} className="pg-code-line" data-a="code-line">
            {line === "" ? " " : highlightLine(line)}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface TermLine {
  readonly text: string;
  readonly tone?: "ink" | "soft" | "faint" | "coral" | "lime";
}

/** A terminal at an explicit box. `✗` renders as a drawn cell; everything else is text. */
export function Terminal({
  lines,
  fontSize,
  lineHeight,
  box,
  a = "term",
}: {
  lines: ReadonlyArray<TermLine>;
  fontSize: number;
  lineHeight: number;
  box: { left: number; top: number; width: number; height: number };
  a?: string;
}) {
  return (
    <div
      className="pg-term"
      data-a={a}
      data-cols={Math.max(...lines.map((line) => line.text.length))}
      data-rows={lines.length}
      data-font={fontSize}
      data-line={lineHeight}
      style={box}
    >
      <div className="pg-term-bar">
        <i />
        <i />
        <i />
      </div>
      <div style={{ padding: `22px ${CODE_PAD}px`, fontSize, lineHeight: `${lineHeight}px` }}>
        {lines.map((line, index) => (
          <div
            key={index}
            className="pg-term-line"
            data-a="term-line"
            style={{ color: `var(--pg-${line.tone ?? "ink"})` }}
          >
            {line.text === ""
              ? " "
              : line.text
                  .split("✗")
                  .flatMap((part, at) =>
                    at === 0 ? [part] : [<Cross key={at} size={fontSize} />, part],
                  )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Cards ------------------------------------------------------------------------------------ */

export function Card({
  label,
  tone,
  a,
  style,
  children,
}: {
  label: ReactNode;
  tone?: "lime" | "coral";
  a?: string;
  style: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      data-a={a}
      className={tone === undefined ? "pg-card" : `pg-card pg-card--${tone}`}
      style={{ padding: "22px 26px", ...style }}
    >
      <div className="pg-card-label" style={{ marginBottom: children === undefined ? 0 : 16 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/** Name/value rows in mono: what a derived output contains. */
export function Rows({ rows }: { rows: ReadonlyArray<{ name: string; value: ReactNode }> }) {
  return (
    <dl className="pg-rows" style={{ margin: 0 }}>
      {rows.map((row) => (
        <div key={row.name} style={{ display: "contents" }}>
          <dt>{row.name}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Chip({
  children,
  lime,
  a,
  style,
}: {
  children: ReactNode;
  lime?: boolean;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={lime ? "pg-chip pg-chip--lime" : "pg-chip"} style={style}>
      <i />
      {children}
    </span>
  );
}

export function Badge({
  tone,
  children,
  a,
  style,
}: {
  tone: "lime" | "coral" | "ink";
  children: ReactNode;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={`pg-badge pg-badge--${tone}`} style={style}>
      {children}
    </span>
  );
}

/** A graph node at an explicit position. */
export function Node({
  path,
  x,
  y,
  tone,
  a = "node",
}: {
  path: string;
  x: number;
  y: number;
  tone?: "declared" | "missing";
  a?: string;
}) {
  return (
    <span
      data-a={a}
      className={tone === undefined ? "pg-node" : `pg-node pg-node--${tone}`}
      style={{ left: x, top: y }}
    >
      <i />
      {path}
    </span>
  );
}
