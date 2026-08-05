/**
 * GET /api/taxonomy — the option lists the Personalize screen renders.
 *
 * WHY serve this instead of hard-coding it in the app: adding a skill or a
 * country would otherwise require a new APK build and a user update. Served
 * from the backend, a new option appears on every device on next launch, and
 * — critically — the ids the app sends back are guaranteed to be ids the
 * scorer actually understands. The app ships a bundled copy as an offline
 * fallback and prefers this response when it is reachable.
 */

import { withApi } from '../src/http/apiKit.js';
import {
  COUNTRIES,
  CURRENCIES,
  JOB_TYPES,
  LEVELS,
  SKILLS,
  SKILL_GROUPS,
  WORKPLACES,
} from '../src/core/taxonomy.js';
import { DEFAULT_THRESHOLDS } from '../src/reco/weights.js';

export default withApi({ methods: ['GET'], auth: false }, async () => ({
  taxonomy: {
    countries: COUNTRIES.map(({ id, label }) => ({ id, label })),
    skills: SKILLS.map(({ id, label, group }) => ({ id, label, group })),
    skillGroups: SKILL_GROUPS,
    jobTypes: JOB_TYPES,
    workplaces: WORKPLACES,
    levels: LEVELS,
    currencies: CURRENCIES,
    defaults: DEFAULT_THRESHOLDS,
  },
}));
