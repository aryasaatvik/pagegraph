import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Runs before paint so a stored choice never flashes the other theme. */
export const themeScript = `try{var t=localStorage.getItem("pg-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function currentTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | undefined>(undefined);
  useEffect(() => setTheme(currentTheme()), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="icon"
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("pg-theme", next);
        } catch {
          // Private windows can refuse storage; the choice still applies to this page.
        }
        setTheme(next);
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
      </svg>
    </button>
  );
}
