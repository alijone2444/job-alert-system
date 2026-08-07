import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { RemoteMessageData } from '../types';
import { SOURCE_LABELS } from '../domain/taxonomy';
import { colors, matchTone, radius, shadow, sourceColors, spacing } from '../theme';

type Props = {
  alert: RemoteMessageData | null;
  onOpen: (alert: RemoteMessageData) => void;
  onDismiss: () => void;
};

/** Long enough to read a job title, short enough not to sit in the way. */
const VISIBLE_MS = 6000;

/**
 * In-app banner for a match that arrives while the app is open.
 *
 * WHY THIS EXISTS: system notifications are suppressed in the foreground —
 * originally so a popup would not interrupt someone already looking at the
 * feed. But the message was then dropped ENTIRELY, so a job that arrived while
 * the app was open was announced nowhere. A user testing notifications with the
 * app open concluded, reasonably, that notifications were broken.
 *
 * The original instinct was right — no OS popup over an app that is already
 * showing the answer — but "don't interrupt" is not the same as "say nothing".
 * A banner is visible from any tab (Saved and Personalize show no feed at all)
 * and is tappable, without hijacking the screen.
 */
export function InAppAlert({ alert, onOpen, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-160)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(
    (after?: () => void) => {
      Animated.timing(slide, { toValue: -160, duration: 220, useNativeDriver: true }).start(
        () => after?.()
      );
    },
    [slide]
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!alert) {
      hide();
      return;
    }

    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();

    timer.current = setTimeout(() => hide(onDismiss), VISIBLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [alert, slide, hide, onDismiss]);

  if (!alert) return null;

  const score = Number(alert.score) || 0;
  const tone = matchTone(score);
  const source = alert.source ?? '';
  const isDigest = alert.type === 'digest';

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { top: insets.top + spacing.sm, transform: [{ translateY: slide }] },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (timer.current) clearTimeout(timer.current);
          hide(() => onOpen(alert));
        }}
        style={styles.card}
      >
        <View style={[styles.scorePill, { backgroundColor: tone.soft }]}>
          {isDigest ? (
            <Text style={[styles.scoreText, { color: tone.color }]}>{alert.count ?? '+'}</Text>
          ) : (
            <>
              <Text style={[styles.scoreText, { color: tone.color }]}>{score}</Text>
              <Text style={[styles.scorePercent, { color: tone.color }]}>%</Text>
            </>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {isDigest
              ? `${alert.count ?? ''} new matches`
              : `New match · ${SOURCE_LABELS[source] ?? source}`}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {alert.title || 'A new job matched your profile'}
          </Text>
          {alert.company ? (
            <Text style={styles.company} numberOfLines={1}>
              {alert.company}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            hide(onDismiss);
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.close}
        >
          <Icon name="close" size={15} color={colors.textSubtle} />
        </TouchableOpacity>
      </TouchableOpacity>

      <View
        style={[
          styles.accent,
          { backgroundColor: sourceColors[source] ?? colors.primary },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1000,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadow.card,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 8,
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderRadius: radius.md,
    paddingHorizontal: 9,
    paddingVertical: 6,
    minWidth: 44,
    justifyContent: 'center',
  },
  scoreText: { fontSize: 15, fontWeight: '800' },
  scorePercent: { fontSize: 9, fontWeight: '700', marginLeft: 1 },

  body: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: colors.textSubtle, letterSpacing: 0.3 },
  title: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2, lineHeight: 18 },
  company: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

  close: { padding: 2 },

  // Thin source-coloured underline, matching the colour used on the card badge
  // and on the system notification, so the two read as the same thing.
  accent: {
    height: 3,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginTop: -2,
  },
});
