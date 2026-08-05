/**
 * Bundled mirror of the backend taxonomy (backend/src/core/taxonomy.js).
 *
 * WHY a bundled copy when `GET /api/taxonomy` exists: the Personalize screen
 * must render instantly and work offline. The app shows THIS list immediately,
 * then quietly swaps in the server's copy when it arrives — so a skill added
 * on the backend reaches every device without an APK update, while a device
 * with no connectivity still has a usable settings screen.
 *
 * The ids here MUST match the backend's. They are the contract the scorer
 * speaks; a mismatched id is silently ignored by `sanitizeIds` server-side, so
 * the preference would appear to save and then do nothing.
 */

export type Option = { id: string; label: string; group?: string };

export const WORKPLACES: Option[] = [
  { id: 'remote', label: 'Remote' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'onsite', label: 'On-site' },
];

export const JOB_TYPES: Option[] = [
  { id: 'full_time', label: 'Full-time' },
  { id: 'part_time', label: 'Part-time' },
  { id: 'contract', label: 'Contract' },
  { id: 'internship', label: 'Internship' },
  { id: 'freelance', label: 'Freelance' },
];

export const LEVELS: Option[] = [
  { id: 'entry', label: 'Entry' },
  { id: 'junior', label: 'Junior' },
  { id: 'mid', label: 'Mid' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
];

export const COUNTRIES: Option[] = [
  { id: 'PK', label: 'Pakistan' },
  { id: 'US', label: 'United States' },
  { id: 'GB', label: 'United Kingdom' },
  { id: 'CA', label: 'Canada' },
  { id: 'AE', label: 'United Arab Emirates' },
  { id: 'AU', label: 'Australia' },
  { id: 'DE', label: 'Germany' },
  { id: 'IN', label: 'India' },
  { id: 'SA', label: 'Saudi Arabia' },
  { id: 'NL', label: 'Netherlands' },
  { id: 'SG', label: 'Singapore' },
  { id: 'IE', label: 'Ireland' },
];

export const SKILLS: Option[] = [
  { id: 'react', label: 'React', group: 'Frontend' },
  { id: 'nextjs', label: 'Next.js', group: 'Frontend' },
  { id: 'vue', label: 'Vue', group: 'Frontend' },
  { id: 'angular', label: 'Angular', group: 'Frontend' },
  { id: 'svelte', label: 'Svelte', group: 'Frontend' },
  { id: 'redux', label: 'Redux', group: 'Frontend' },
  { id: 'html_css', label: 'HTML/CSS', group: 'Frontend' },
  { id: 'threejs', label: 'Three.js', group: 'Frontend' },

  { id: 'react_native', label: 'React Native', group: 'Mobile' },
  { id: 'flutter', label: 'Flutter', group: 'Mobile' },
  { id: 'swift', label: 'Swift', group: 'Mobile' },
  { id: 'kotlin', label: 'Kotlin', group: 'Mobile' },
  { id: 'android', label: 'Android', group: 'Mobile' },

  { id: 'javascript', label: 'JavaScript', group: 'Languages' },
  { id: 'typescript', label: 'TypeScript', group: 'Languages' },
  { id: 'python', label: 'Python', group: 'Languages' },
  { id: 'php', label: 'PHP', group: 'Languages' },
  { id: 'java', label: 'Java', group: 'Languages' },
  { id: 'golang', label: 'Go', group: 'Languages' },
  { id: 'rust', label: 'Rust', group: 'Languages' },
  { id: 'ruby', label: 'Ruby', group: 'Languages' },

  { id: 'nodejs', label: 'Node.js', group: 'Backend' },
  { id: 'express', label: 'Express', group: 'Backend' },
  { id: 'nestjs', label: 'NestJS', group: 'Backend' },
  { id: 'mern', label: 'MERN', group: 'Backend' },
  { id: 'graphql', label: 'GraphQL', group: 'Backend' },
  { id: 'django', label: 'Django', group: 'Backend' },
  { id: 'flask', label: 'Flask', group: 'Backend' },
  { id: 'laravel', label: 'Laravel', group: 'Backend' },
  { id: 'spring_boot', label: 'Spring Boot', group: 'Backend' },
  { id: 'dotnet', label: '.NET', group: 'Backend' },

  { id: 'mongodb', label: 'MongoDB', group: 'Database' },
  { id: 'postgres', label: 'PostgreSQL', group: 'Database' },
  { id: 'mysql', label: 'MySQL', group: 'Database' },
  { id: 'redis', label: 'Redis', group: 'Database' },
  { id: 'sql', label: 'SQL', group: 'Database' },
  { id: 'firebase', label: 'Firebase', group: 'Database' },

  { id: 'aws', label: 'AWS', group: 'DevOps' },
  { id: 'azure', label: 'Azure', group: 'DevOps' },
  { id: 'gcp', label: 'GCP', group: 'DevOps' },
  { id: 'docker', label: 'Docker', group: 'DevOps' },
  { id: 'kubernetes', label: 'Kubernetes', group: 'DevOps' },
  { id: 'devops', label: 'DevOps', group: 'DevOps' },

  { id: 'machine_learning', label: 'Machine Learning', group: 'AI' },
  { id: 'ai_engineering', label: 'AI Engineering', group: 'AI' },
  { id: 'data_science', label: 'Data Science', group: 'AI' },
  { id: 'computer_vision', label: 'Computer Vision', group: 'AI' },
];

export const SKILL_GROUPS = ['Frontend', 'Mobile', 'Languages', 'Backend', 'Database', 'DevOps', 'AI'];

export const CURRENCIES = ['USD', 'PKR', 'GBP', 'EUR', 'AED', 'CAD', 'AUD', 'INR', 'SAR', 'SGD'];

export type Taxonomy = {
  countries: Option[];
  skills: Option[];
  skillGroups: string[];
  jobTypes: Option[];
  workplaces: Option[];
  levels: Option[];
  currencies: string[];
};

export const BUNDLED_TAXONOMY: Taxonomy = {
  countries: COUNTRIES,
  skills: SKILLS,
  skillGroups: SKILL_GROUPS,
  jobTypes: JOB_TYPES,
  workplaces: WORKPLACES,
  levels: LEVELS,
  currencies: CURRENCIES,
};

/** id -> label, for rendering a job's stored ids as human text. */
export function labelFor(options: Option[], id?: string | null): string {
  if (!id) return '';
  return options.find((option) => option.id === id)?.label ?? id;
}

export const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  remoteok: 'RemoteOK',
  weworkremotely: 'We Work Remotely',
  rozee: 'Rozee.pk',
  indeed: 'Indeed',
  wellfound: 'Wellfound',
};
