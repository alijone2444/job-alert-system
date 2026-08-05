import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { usePreferences } from '../hooks/usePreferences';
import { ScreenHeader } from '../components/ScreenHeader';
import { SectionCard } from '../components/SectionCard';
import { MultiSelect } from '../components/MultiSelect';
import { Chip } from '../components/Chip';
import { TagInput } from '../components/TagInput';
import { colors, matchTone, radius, spacing } from '../theme';

/**
 * The Personalize tab — its own bottom-tab entry so the feed stays clean.
 *
 * Ordering is by IMPACT on the score, not by alphabet: skills (weight 34) sit
 * at the top, salary and keywords at the bottom. A user who edits only the
 * first two sections has already meaningfully personalised their feed.
 *
 * Nothing is saved until the sticky bar is used. Every edit here triggers a
 * server-side feed rebuild, so auto-saving on each chip tap would fire dozens
 * of rebuilds while the user is still deciding.
 */
export function PersonalizeScreen() {
  const { userId, user, signOut } = useAppContext();
  const {
    draft,
    taxonomy,
    loading,
    saving,
    isDirty,
    selectedCount,
    update,
    toggle,
    clear,
    save,
    reset,
  } = usePreferences(userId);

  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    try {
      const result = await save();
      const matched = result?.matched;
      setSavedNotice(
        matched === undefined
          ? 'Preferences saved'
          : `Saved — ${matched} job${matched === 1 ? '' : 's'} now match`
      );
      setTimeout(() => setSavedNotice(null), 4000);
    } catch (error) {
      Alert.alert('Could not save', (error as Error).message);
    }
  }, [save]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Personalize" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const feedTone = matchTone(draft.feedThreshold);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Personalize"
        subtitle={
          selectedCount
            ? `${selectedCount} preference${selectedCount === 1 ? '' : 's'} shaping your feed`
            : 'Pick what you care about — your feed rebuilds instantly'
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------------------- ACCOUNT --------------------------- */}
        <SectionCard title="Account">
          <View style={styles.accountRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.accountText}>
              <Text style={styles.accountName} numberOfLines={1}>
                {user?.displayName || 'Signed in'}
              </Text>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {user?.email || userId}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() =>
                Alert.alert('Sign out?', 'Your preferences and saved jobs stay on your account.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
                ])
              }
              style={styles.signOutButton}
              activeOpacity={0.8}
            >
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            Everything below is tied to this account, so it follows you to a new phone.
          </Text>
        </SectionCard>

        {/* ---------------------------- SKILLS ---------------------------- */}
        <SectionCard
          title="Skills"
          subtitle="The single biggest factor in your match score. Select as many as apply — matching any 3 gives full credit."
          count={draft.skills.length}
          action={draft.skills.length ? { label: 'Clear', onPress: () => clear('skills') } : undefined}
        >
          <MultiSelect
            options={taxonomy.skills}
            selected={draft.skills}
            onToggle={(id) => toggle('skills', id)}
            searchable
            searchPlaceholder="Search skills — react, node, python…"
            grouped
          />
        </SectionCard>

        {/* --------------------------- COUNTRIES -------------------------- */}
        <SectionCard
          title="Countries"
          subtitle="Select every country you would work in. Remote jobs from elsewhere still score partially."
          count={draft.countries.length}
          action={
            draft.countries.length ? { label: 'Clear', onPress: () => clear('countries') } : undefined
          }
        >
          <MultiSelect
            options={taxonomy.countries}
            selected={draft.countries}
            onToggle={(id) => toggle('countries', id)}
          />

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Strict country matching</Text>
              <Text style={styles.switchHint}>
                Completely exclude on-site jobs outside your selection, instead of ranking them lower.
              </Text>
            </View>
            <Switch
              value={draft.strictCountry}
              onValueChange={(value) => update('strictCountry', value)}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
        </SectionCard>

        {/* -------------------------- WORKPLACE --------------------------- */}
        <SectionCard
          title="Workplace"
          subtitle="Remote, hybrid, on-site — choose any combination."
          count={draft.workplaces.length}
        >
          <MultiSelect
            options={taxonomy.workplaces}
            selected={draft.workplaces}
            onToggle={(id) => toggle('workplaces', id)}
          />
        </SectionCard>

        {/* --------------------------- JOB TYPE --------------------------- */}
        <SectionCard title="Job type" count={draft.jobTypes.length}>
          <MultiSelect
            options={taxonomy.jobTypes}
            selected={draft.jobTypes}
            onToggle={(id) => toggle('jobTypes', id)}
          />
        </SectionCard>

        {/* ------------------------ EXPERIENCE LEVEL ---------------------- */}
        <SectionCard
          title="Experience level"
          subtitle="Neighbouring levels still score partially — a senior role is not discarded for a mid-level profile."
          count={draft.levels.length}
        >
          <MultiSelect
            options={taxonomy.levels}
            selected={draft.levels}
            onToggle={(id) => toggle('levels', id)}
          />
        </SectionCard>

        {/* ---------------------------- SALARY ---------------------------- */}
        <SectionCard
          title="Salary (optional)"
          subtitle="Most boards do not publish pay. Jobs without a salary are never penalised for it."
        >
          <View style={styles.salaryRow}>
            <View style={styles.salaryField}>
              <Text style={styles.fieldLabel}>Minimum / year</Text>
              <TextInput
                value={draft.salary.min ? String(draft.salary.min) : ''}
                onChangeText={(text) =>
                  update('salary', { ...draft.salary, min: text ? Number(text.replace(/\D/g, '')) : null })
                }
                keyboardType="number-pad"
                placeholder="e.g. 60000"
                placeholderTextColor={colors.textSubtle}
                style={styles.input}
              />
            </View>
            <View style={styles.salaryField}>
              <Text style={styles.fieldLabel}>Maximum / year</Text>
              <TextInput
                value={draft.salary.max ? String(draft.salary.max) : ''}
                onChangeText={(text) =>
                  update('salary', { ...draft.salary, max: text ? Number(text.replace(/\D/g, '')) : null })
                }
                keyboardType="number-pad"
                placeholder="optional"
                placeholderTextColor={colors.textSubtle}
                style={styles.input}
              />
            </View>
          </View>

          <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Currency</Text>
          <View style={styles.chipRow}>
            {taxonomy.currencies.map((currency) => (
              <Chip
                key={currency}
                size="sm"
                label={currency}
                selected={draft.salary.currency === currency}
                onPress={() => update('salary', { ...draft.salary, currency })}
              />
            ))}
          </View>
        </SectionCard>

        {/* --------------------------- COMPANIES -------------------------- */}
        <SectionCard
          title="Companies"
          subtitle="Preferred companies get a score boost. Blocked companies are removed entirely, whatever they score."
        >
          <Text style={styles.fieldLabel}>Preferred</Text>
          <TagInput
            values={draft.preferredCompanies}
            onChange={(values) => update('preferredCompanies', values)}
            placeholder="Add a company you'd love to work at"
            tone="positive"
          />

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Blocked</Text>
          <TagInput
            values={draft.blockedCompanies}
            onChange={(values) => update('blockedCompanies', values)}
            placeholder="Add a company to never show"
            tone="negative"
          />
        </SectionCard>

        {/* --------------------------- KEYWORDS --------------------------- */}
        <SectionCard
          title="Keywords"
          subtitle="Matched anywhere in the title, company or description."
        >
          <Text style={styles.fieldLabel}>Must mention</Text>
          <TagInput
            values={draft.keywordsInclude}
            onChange={(values) => update('keywordsInclude', values)}
            placeholder="e.g. fintech, startup, visa sponsorship"
            tone="positive"
          />

          <View style={styles.divider} />

          <Text style={styles.fieldLabel}>Never show</Text>
          <TagInput
            values={draft.keywordsExclude}
            onChange={(values) => update('keywordsExclude', values)}
            placeholder="e.g. unpaid, commission only"
            tone="negative"
          />
        </SectionCard>

        {/* -------------------------- THRESHOLDS -------------------------- */}
        <SectionCard
          title="Match thresholds"
          subtitle="How selective your feed and your notifications are."
        >
          <View style={styles.thresholdBlock}>
            <View style={styles.thresholdHeader}>
              <Text style={styles.fieldLabel}>Show in feed above</Text>
              <View style={[styles.thresholdValue, { backgroundColor: feedTone.soft }]}>
                <Text style={[styles.thresholdValueText, { color: feedTone.color }]}>
                  {draft.feedThreshold}%
                </Text>
              </View>
            </View>
            <View style={styles.chipRow}>
              {[50, 60, 70, 80, 85, 90].map((value) => (
                <Chip
                  key={value}
                  size="sm"
                  label={`${value}%`}
                  selected={draft.feedThreshold === value}
                  onPress={() => update('feedThreshold', value)}
                />
              ))}
            </View>
            <Text style={styles.hint}>
              Higher means fewer, better jobs. Start around 70% and raise it once you see enough
              volume — 85%+ can be very quiet on a slow day.
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.thresholdBlock}>
            <View style={styles.thresholdHeader}>
              <Text style={styles.fieldLabel}>Notify me above</Text>
              <View style={[styles.thresholdValue, { backgroundColor: colors.primarySoft }]}>
                <Text style={[styles.thresholdValueText, { color: colors.primary }]}>
                  {draft.notifyThreshold}%
                </Text>
              </View>
            </View>
            {/* 85 is a hard floor enforced by the backend, not just a default —
                a weak match must never be allowed to interrupt you. */}
            <View style={styles.chipRow}>
              {[85, 90, 95].map((value) => (
                <Chip
                  key={value}
                  size="sm"
                  label={`${value}%`}
                  selected={draft.notifyThreshold === value}
                  onPress={() => update('notifyThreshold', value)}
                />
              ))}
            </View>
            <Text style={styles.hint}>
              Anything below 85% stays in your feed and never sends a notification.
            </Text>

            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>Push notifications</Text>
                <Text style={styles.switchHint}>
                  At most 3 alerts per check; more than that arrives as one summary.
                </Text>
              </View>
              <Switch
                value={draft.notificationsEnabled}
                onValueChange={(value) => update('notificationsEnabled', value)}
                trackColor={{ true: colors.primary, false: colors.borderStrong }}
                thumbColor={colors.surface}
              />
            </View>
          </View>
        </SectionCard>

        <View style={styles.scrollTail} />
      </ScrollView>

      {/* --------------------------- STICKY BAR --------------------------- */}
      {isDirty || savedNotice ? (
        <View style={styles.saveBar}>
          {savedNotice && !isDirty ? (
            <Text style={styles.savedNotice}>{savedNotice}</Text>
          ) : (
            <>
              <TouchableOpacity onPress={reset} style={styles.discardButton} disabled={saving}>
                <Text style={styles.discardText}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.saveText}>Save & rebuild feed</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: spacing.md },
  scrollTail: { height: 96 },

  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  hint: { fontSize: 11, color: colors.textSubtle, lineHeight: 16, marginTop: spacing.sm },

  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.text,
  },
  salaryRow: { flexDirection: 'row', gap: spacing.md },
  salaryField: { flex: 1 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '800', color: colors.primary },
  accountText: { flex: 1 },
  accountName: { fontSize: 14, fontWeight: '700', color: colors.text },
  accountEmail: { fontSize: 12, color: colors.textSubtle, marginTop: 1 },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  signOutText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  switchHint: { fontSize: 11, color: colors.textSubtle, marginTop: 2, lineHeight: 16 },

  thresholdBlock: { gap: spacing.sm },
  thresholdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thresholdValue: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  thresholdValueText: { fontSize: 12, fontWeight: '800' },

  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  discardButton: { paddingHorizontal: spacing.lg, paddingVertical: 11 },
  discardText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.7 },
  saveText: { fontSize: 14, fontWeight: '700', color: colors.textInverse },
  savedNotice: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
    paddingVertical: 12,
  },
});
