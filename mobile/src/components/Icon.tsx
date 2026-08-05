import React from 'react';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';

/**
 * Line icons, drawn as SVG paths.
 *
 * WHY not emoji: emoji glyphs come from the device font, so they are not ours
 * to control — the test device had no glyph for 🎛️ and rendered a tofu box,
 * and every vendor draws 🎯 and ⭐ differently, in their own colours, at their
 * own optical weight. A tab bar built from them cannot be made to look like one
 * set. These are stroked paths: one weight, one colour, sized by us.
 *
 * WHY not an icon font package: react-native-vector-icons needs font assets
 * linked into both native projects. This is a handful of paths with one
 * already-autolinked dependency.
 */

export type IconName =
  | 'target'
  | 'bookmark'
  | 'sliders'
  | 'activity'
  | 'search'
  | 'close'
  | 'star'
  | 'star-filled'
  | 'external';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Stroke width before scaling. 24x24 viewBox. */
  weight?: number;
};

export function Icon({ name, size = 24, color = '#111827', weight = 1.9 }: Props) {
  const stroke = {
    stroke: color,
    strokeWidth: weight,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, stroke, color)}
    </Svg>
  );
}

function renderPaths(name: IconName, stroke: object, color: string) {
  switch (name) {
    // Concentric target — "jobs aimed at you".
    case 'target':
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" {...stroke} />
          <Circle cx="12" cy="12" r="4.5" {...stroke} />
          <Circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
        </>
      );

    // Bookmark rather than a star: this is "kept for later", not "rated".
    case 'bookmark':
      return <Path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-4-6.5 4v-14a1 1 0 0 1 1-1z" {...stroke} />;

    // Mixer sliders — tuning, which is exactly what the screen does.
    case 'sliders':
      return (
        <>
          <Line x1="5" y1="21" x2="5" y2="14" {...stroke} />
          <Line x1="5" y1="10" x2="5" y2="3" {...stroke} />
          <Line x1="12" y1="21" x2="12" y2="12" {...stroke} />
          <Line x1="12" y1="8" x2="12" y2="3" {...stroke} />
          <Line x1="19" y1="21" x2="19" y2="16" {...stroke} />
          <Line x1="19" y1="12" x2="19" y2="3" {...stroke} />
          <Line x1="2.5" y1="12" x2="7.5" y2="12" {...stroke} />
          <Line x1="9.5" y1="10" x2="14.5" y2="10" {...stroke} />
          <Line x1="16.5" y1="14" x2="21.5" y2="14" {...stroke} />
        </>
      );

    // Heartbeat line — system health.
    case 'activity':
      return <Path d="M2.5 12h4l2.5-7 5 14 2.5-7h5" {...stroke} />;

    case 'search':
      return (
        <>
          <Circle cx="11" cy="11" r="6.5" {...stroke} />
          <Line x1="16" y1="16" x2="21" y2="21" {...stroke} />
        </>
      );

    case 'close':
      return (
        <>
          <Line x1="6" y1="6" x2="18" y2="18" {...stroke} />
          <Line x1="18" y1="6" x2="6" y2="18" {...stroke} />
        </>
      );

    case 'star':
      return (
        <Path
          d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z"
          {...stroke}
        />
      );

    case 'star-filled':
      return (
        <Path
          d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z"
          fill={color}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      );

    case 'external':
      return (
        <>
          <Path d="M13.5 4.5h6v6" {...stroke} />
          <Line x1="19.5" y1="4.5" x2="11" y2="13" {...stroke} />
          <Path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" {...stroke} />
        </>
      );

    default:
      return <Rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />;
  }
}
