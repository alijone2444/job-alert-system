/**
 * Preferences state for the Personalize screen.
 *
 * Holds a LOCAL draft separate from the saved copy. Editing a chip must feel
 * instantaneous, but every keystroke cannot trigger a server-side feed
 * rebuild — so edits mutate the draft, and `save()` commits. `isDirty` drives
 * the sticky save bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Preferences } from '../types';
import {
  DEFAULT_PREFERENCES,
  savePreferences,
  subscribeToPreferences,
  loadTaxonomy,
} from '../services/preferences';
import { BUNDLED_TAXONOMY, Taxonomy } from '../domain/taxonomy';
import { logger } from '../utils/logger';

export function usePreferences(userId: string | null) {
  const [saved, setSaved] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [draft, setDraft] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>(BUNDLED_TAXONOMY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<{ matched?: number } | null>(null);

  // Guards against a server snapshot arriving mid-edit and wiping the draft.
  const hasLocalEdits = useRef(false);

  useEffect(() => {
    loadTaxonomy().then(setTaxonomy);
  }, []);

  useEffect(() => {
    if (!userId) return;

    return subscribeToPreferences(userId, (preferences) => {
      setSaved(preferences);
      if (!hasLocalEdits.current) setDraft(preferences);
      setLoading(false);
    });
  }, [userId]);

  /** Patch the draft. Multi-select toggles all funnel through here. */
  const update = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    hasLocalEdits.current = true;
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  /** Toggle one id inside a multi-select list. Never limits to one value. */
  const toggle = useCallback(
    (key: 'countries' | 'skills' | 'jobTypes' | 'workplaces' | 'levels', id: string) => {
      hasLocalEdits.current = true;
      setDraft((current) => {
        const list = current[key];
        const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
        return { ...current, [key]: next };
      });
    },
    []
  );

  const clear = useCallback((key: 'countries' | 'skills' | 'jobTypes' | 'workplaces' | 'levels') => {
    hasLocalEdits.current = true;
    setDraft((current) => ({ ...current, [key]: [] }));
  }, []);

  const isDirty = useMemo(() => {
    const fields: (keyof Preferences)[] = [
      'countries',
      'skills',
      'jobTypes',
      'workplaces',
      'levels',
      'salary',
      'preferredCompanies',
      'blockedCompanies',
      'keywordsInclude',
      'keywordsExclude',
      'strictCountry',
      'feedThreshold',
      'notifyThreshold',
      'notificationsEnabled',
    ];
    return fields.some((field) => JSON.stringify(draft[field]) !== JSON.stringify(saved[field]));
  }, [draft, saved]);

  const save = useCallback(async () => {
    if (!userId) return null;
    setSaving(true);
    try {
      const result = await savePreferences(userId, draft);
      hasLocalEdits.current = false;
      setSaved(draft);
      setLastResult({ matched: result.matched });
      return result;
    } catch (error) {
      logger.error('Preferences', 'Save failed', error);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [userId, draft]);

  const reset = useCallback(() => {
    hasLocalEdits.current = false;
    setDraft(saved);
  }, [saved]);

  const selectedCount = useMemo(
    () =>
      draft.countries.length +
      draft.skills.length +
      draft.jobTypes.length +
      draft.workplaces.length +
      draft.levels.length,
    [draft]
  );

  return {
    draft,
    saved,
    taxonomy,
    loading,
    saving,
    isDirty,
    lastResult,
    selectedCount,
    update,
    toggle,
    clear,
    save,
    reset,
  };
}
