/**
 * Design tokens.
 *
 * Every colour, radius and spacing value in the app comes from here. Screens
 * import tokens, never raw hex — so a palette change is one file, and two
 * screens can never drift into slightly different greys.
 */

export const colors = {
  // Surfaces
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F5',
  border: '#E4E7EB',
  borderStrong: '#CDD2D9',

  // Text
  text: '#111827',
  textMuted: '#5B6472',
  textSubtle: '#8A93A1',
  textInverse: '#FFFFFF',

  // Brand
  primary: '#2563EB',
  primarySoft: '#E8EFFE',
  primaryPressed: '#1D4ED8',

  // Status
  success: '#0E9F6E',
  successSoft: '#E3F6EE',
  warning: '#D97706',
  warningSoft: '#FDF0DF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
} as const;

/**
 * Match-score colours. Deliberately a 4-step scale, not a gradient — a user
 * should be able to tell "great match" from "decent match" at a glance while
 * scrolling, and continuous colour cannot do that.
 */
export const matchColors = [
  { min: 90, color: '#0E9F6E', soft: '#E3F6EE', label: 'Excellent' },
  { min: 80, color: '#2563EB', soft: '#E8EFFE', label: 'Strong' },
  { min: 65, color: '#D97706', soft: '#FDF0DF', label: 'Good' },
  { min: 0, color: '#6B7280', soft: '#F1F3F5', label: 'Fair' },
] as const;

export function matchTone(score: number) {
  return matchColors.find((tone) => score >= tone.min) ?? matchColors[matchColors.length - 1];
}

/** Per-source brand colours, used by the source badge on every card. */
export const sourceColors: Record<string, string> = {
  linkedin: '#0A66C2',
  greenhouse: '#24A47F',
  lever: '#5C6AC4',
  ashby: '#7C3AED',
  remoteok: '#FF4742',
  weworkremotely: '#1F6FEB',
  rozee: '#0B7A3B',
  indeed: '#2164F3',
  wellfound: '#111827',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.text },
  bodyStrong: { fontSize: 14, fontWeight: '600' as const, color: colors.text },
  caption: { fontSize: 12, fontWeight: '500' as const, color: colors.textMuted },
  micro: { fontSize: 11, fontWeight: '600' as const, color: colors.textSubtle },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;
