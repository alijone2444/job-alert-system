/**
 * POST /api/interactions — save / unsave / hide / unhide / apply.
 *
 *   { userId, jobKey, action: 'save'|'unsave'|'hide'|'unhide'|'apply', snapshot? }
 *
 * WHY one endpoint with an `action` instead of /save, /hide, /apply: these are
 * mutually-exclusive transitions on the SAME document. Splitting them into
 * separate routes invites two of them racing and leaving a job both saved and
 * hidden. One endpoint, one document, one write.
 *
 * `apply` NEVER submits an application. It records that the user opened the
 * original posting; the app then opens `applyUrl` in the browser. We do not
 * replicate, proxy or intermediate anybody's application flow.
 */

import { withApi, requireUserId, badRequest } from '../src/http/apiKit.js';
import * as interactionsRepo from '../src/repositories/interactionsRepo.js';
import { INTERACTION } from '../src/repositories/interactionsRepo.js';
import * as jobsRepo from '../src/repositories/jobsRepo.js';

const ACTIONS = new Set(['save', 'unsave', 'hide', 'unhide', 'apply']);

/**
 * Keep a display copy on the interaction document.
 * A saved job must still render after the shared `jobs` record is pruned by
 * retention — otherwise the Saved tab decays into a list of dead ids.
 */
function toSnapshot(job) {
  if (!job) return null;
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    country: job.country,
    workplace: job.workplace,
    jobType: job.jobType,
    salary: job.salary,
    source: job.sourceId,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,
    skills: (job.skills || []).slice(0, 10),
  };
}

export default withApi({ methods: ['POST'] }, async (ctx) => {
  const userId = requireUserId(ctx);
  const { jobKey, action } = ctx.body || {};

  if (!jobKey || typeof jobKey !== 'string') throw badRequest('jobKey is required');
  if (!ACTIONS.has(action)) {
    throw badRequest(`action must be one of: ${[...ACTIONS].join(', ')}`);
  }

  // Prefer the client's snapshot (it already has the feed entry in hand), fall
  // back to a lookup so the API is correct even when called without one.
  const snapshot =
    ctx.body.snapshot && typeof ctx.body.snapshot === 'object'
      ? ctx.body.snapshot
      : toSnapshot(await jobsRepo.findByKey(jobKey));

  switch (action) {
    case 'save':
      await interactionsRepo.setState(userId, jobKey, INTERACTION.SAVED, snapshot);
      break;
    case 'hide':
      await interactionsRepo.setState(userId, jobKey, INTERACTION.HIDDEN, snapshot);
      break;
    case 'unsave':
    case 'unhide':
      await interactionsRepo.setState(userId, jobKey, INTERACTION.NONE);
      break;
    case 'apply':
      await interactionsRepo.recordApply(userId, jobKey, snapshot);
      break;
  }

  return { jobKey, action, applyUrl: snapshot?.applyUrl ?? null };
});
