import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { AuthError, isGoogleSignInAvailable, signInWithGoogle } from '../services/auth';
import { Icon } from '../components/Icon';
import { colors, radius, shadow, spacing } from '../theme';

/** The Google "G", drawn rather than shipped as an asset. */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5C3 17 2 20.4 2 24s1 7 2.5 9.9l7.3-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
      />
    </Svg>
  );
}

function Bullet({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletIcon}>
        <Icon name={icon} size={17} color={colors.primary} />
      </View>
      <View style={styles.bulletText}>
        <Text style={styles.bulletTitle}>{title}</Text>
        <Text style={styles.bulletBody}>{body}</Text>
      </View>
    </View>
  );
}

/**
 * Sign-in gate.
 *
 * Explains WHY an account is required rather than just demanding one — the
 * honest reason (your preferences and saved jobs survive a reinstall or a new
 * phone) is also the persuasive one.
 */
export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = isGoogleSignInAvailable();

  const handleSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // AppContext's auth listener swaps the UI — nothing to do here.
    } catch (err) {
      const authError = err as AuthError;
      // A deliberate cancel is not an error worth shouting about.
      if (authError.code !== 'cancelled') setError(authError.message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Icon name="target" size={44} color={colors.textInverse} weight={2.1} />
        </View>
        <Text style={styles.title}>Job Alert</Text>
        <Text style={styles.subtitle}>
          Fresh jobs from six boards, scored against your own skills — only strong matches reach you.
        </Text>
      </View>

      <View style={styles.card}>
        <Bullet
          icon="sliders"
          title="Your preferences follow you"
          body="Skills, countries and thresholds stay with your account across reinstalls and devices."
        />
        <Bullet
          icon="bookmark"
          title="Saved jobs are never lost"
          body="Anything you star stays available even after the listing is cleared from the system."
        />
        <Bullet
          icon="target"
          title="A feed that is actually yours"
          body="Nobody else sees your matches, and your data is tied to your account, not this handset."
        />
      </View>

      <View style={styles.footer}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!available ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              Google sign-in is not configured in this build. Enable Google in Firebase
              Authentication, download the updated google-services.json, and rebuild.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={handleSignIn}
          disabled={busy || !available}
          activeOpacity={0.85}
          style={[styles.googleButton, (busy || !available) && styles.googleButtonDisabled]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <>
              <GoogleMark />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.legal}>
          We only read your name, email and profile picture — never your Google account contents.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.xl },

  hero: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: spacing.sm,
    maxWidth: 300,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadow.card,
  },
  bullet: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  bulletIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { flex: 1 },
  bulletTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  bulletBody: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: 2 },

  footer: { marginTop: spacing.xxl, gap: spacing.md },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 14,
    ...shadow.card,
  },
  googleButtonDisabled: { opacity: 0.55 },
  googleText: { fontSize: 14, fontWeight: '700', color: colors.text },

  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  errorText: { fontSize: 12, color: colors.danger, lineHeight: 17 },
  warnBox: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.md },
  warnText: { fontSize: 12, color: colors.warning, lineHeight: 17 },

  legal: { fontSize: 11, color: colors.textSubtle, textAlign: 'center', lineHeight: 16 },
});
