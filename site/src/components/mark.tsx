/** The PageGraph mark: a declared root (link blue) with crumb edges to two pages (ink). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 32" fill="none" aria-hidden="true">
      <path
        d="M12 16H20V6H28M20 16V26H28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="1" y="10" width="12" height="12" fill="var(--link)" />
      <rect x="28.25" y="1.25" width="9.5" height="9.5" stroke="currentColor" strokeWidth="2.5" />
      <rect x="28.25" y="21.25" width="9.5" height="9.5" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
