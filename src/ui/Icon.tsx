/**
 * Minimal single-color line icons (24×24, stroke = currentColor), so every
 * symbol in the UI follows the theme instead of rendering as a color emoji.
 */
const P: Record<string, string> = {
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z M12 12.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  target: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M12 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
  locate: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 2v4 M12 18v4 M2 12h4 M18 12h4',
  siren: 'M6.5 18v-5a5.5 5.5 0 0 1 11 0v5 M4.5 18h15v2.5h-15z M12 2.5v2 M4.2 6.2l1.5 1.5 M19.8 6.2l-1.5 1.5 M10 13a2 2 0 0 1 2-2',
  warning: 'M12 3.5 2.5 20h19z M12 10v4.5 M12 17.2v.1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M12 15V4 M8 8l4-4 4 4 M5 13v6.5h14V13',
  phone: 'M6.6 3.5h3l1.5 4.1-2.1 1.4a12 12 0 0 0 6 6l1.4-2.1 4.1 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z',
  mail: 'M3.5 5.5h17v13h-17z M3.5 7l8.5 6 8.5-6',
  bolt: 'M13 2.5 5 13.5h6l-1 8 8-11h-6z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  spark: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2.5 M12 19.5V22 M2 12h2.5 M19.5 12H22 M4.9 4.9l1.8 1.8 M17.3 17.3l1.8 1.8 M4.9 19.1l1.8-1.8 M17.3 6.7l1.8-1.8',
  flame: 'M12 21.5c3.3 0 6-2.5 6-6 0-3.2-2.2-5.4-3.8-8-.5 2-1.6 3-2.7 3.6-.5-2.2-1-4.6-1.5-7.1C7.6 6.6 6 9.9 6 15.5c0 3.5 2.7 6 6 6z',
  satellite: 'M10 10l4 4 M8.5 8.5 5 5l-2.5 2.5L6 11z M15.5 15.5 19 19l-2.5 2.5L13 18z M12.2 8.8l3-3a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-3 3 M17.5 3.5c1.6.4 2.6 1.4 3 3',
  plane: 'M3 13.5 10.5 11 12.6 3h1.6l-.6 8.2L21 13.5v1.7l-7.4-1.4-.6 4.8 2.2 1.6v1.3L12 20.5 8.8 21.5v-1.3l2.2-1.6-.6-4.8L3 15.2z',
  cloud: 'M7 18.5h10.2a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z',
  noentry: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M7.5 12h9',
  drone: 'M9.5 9.5h5v5h-5z M9.5 9.5 6 6 M14.5 9.5 18 6 M9.5 14.5 6 18 M14.5 14.5 18 18 M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  orbit: 'M20 12a8 8 0 1 1-2.4-5.7 M20.5 3.5v4h-4 M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z',
  rescue: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5v9 M7.5 12h9',
  quake: 'M2 12h3.5l2-5 3 10.5 3-13 3 10 1.8-2.5H22',
  flood: 'M3 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0 M3 14c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0 M3 19c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0',
  wind: 'M3 9h11a3 3 0 1 0-3-3 M3 15h15a3 3 0 1 1-3 3 M3 12h7',
  eyeoff: 'M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a16 16 0 0 1-2.6 3.3 M6.2 7.6C4 9.2 3 12 3 12s3.5 6 9 6a8.8 8.8 0 0 0 4.1-1 M9.9 10a3 3 0 0 0 4.1 4.1',
  pencil: 'M4 20h4.5L19.5 9l-4.5-4.5L4 15.5z M13.5 6l4.5 4.5',
  popout: 'M4 8.5h11.5V20H4z M10 4h10v10 M20 4l-8.5 8.5',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  chat: 'M4 5h16v11H9.5L5 20v-4H4z',
  mic: 'M12 14.5a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5.5a3 3 0 0 0 3 3z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
  play: 'M8 5.5v13l10.5-6.5z',
  users: 'M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5 M17 11.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z M16 14.2c2.6.2 4.4 1.8 5 4.8',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 14, className = '', title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}

/** Emoji that can arrive inside team messages (protocol status codes) and the icon shown for each. */
const EMOJI: Record<string, IconName> = { '🚨': 'siren', '⚠': 'warning', '⚠️': 'warning', '✓': 'check', '📍': 'pin', '⚡': 'bolt' };
const EMOJI_RE = /(🚨|⚠️?|✓|📍|⚡)/u;

/** Text with known emoji swapped for single-color icons. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(EMOJI_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (EMOJI[p] ? <Icon key={i} name={EMOJI[p]} size={13} className="inline" /> : p.replace(/^️/, '')))}
    </>
  );
}
