/** Vigilance mark: evil eye with reticle ticks and corner brackets. Uses the theme accent (currentColor). */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="-2 -2 28 28" width={size} height={size} fill="none" aria-hidden>
      <path d="M-0.6 4 V-0.6 H4 M20 -0.6 H24.6 V4 M24.6 20 V24.6 H20 M4 24.6 H-0.6 V20" stroke="currentColor" strokeWidth="1.3" strokeLinecap="square" opacity="0.8" />
      <path d="M2.5 12 Q12 3.6 21.5 12 Q12 20.4 2.5 12 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="4.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
      <path d="M12 1.2 V3.6 M12 20.4 V22.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
