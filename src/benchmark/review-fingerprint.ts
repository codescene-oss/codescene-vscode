import { Review } from '../devtools-api/review-model';

export interface ReviewFingerprint {
  score?: number;
  issueCategories: string[];
}

export interface CompatibilityCheck extends ReviewFingerprint {
  failures: string[];
}

export const expectedJellyfinScore = 1.004356454215819;

export const expectedJellyfinIssueCategories = [
  'Low Cohesion',
  'Brain Method',
  'Bumpy Road Ahead',
  'Deep, Nested Complexity',
  'Overall Code Complexity',
  'Complex Method',
  'Complex Conditional',
  'Large Method',
  'Excess Number of Function Arguments',
  'Constructor Over-Injection',
  'Primitive Obsession',
];

const scoreEpsilon = 1e-9;

export function issueCategories(review: Review): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (category: string) => {
    if (seen.has(category)) return;
    seen.add(category);
    ordered.push(category);
  };
  for (const smell of review['file-level-code-smells']) add(smell.category);
  for (const fn of review['function-level-code-smells']) {
    for (const smell of fn['code-smells']) add(smell.category);
  }
  return ordered;
}

export function fingerprintOf(review: Review): ReviewFingerprint {
  return { score: review.score, issueCategories: issueCategories(review) };
}

export function compatibilityFailures(actual: ReviewFingerprint | undefined): string[] {
  if (!actual || actual.score === undefined) return ['exact EncodingHelper review produced no score'];
  const failures: string[] = [];
  if (Math.abs(actual.score - expectedJellyfinScore) > scoreEpsilon) {
    failures.push(`score ${actual.score} != ${expectedJellyfinScore}`);
  }
  const actualCategories = new Set(actual.issueCategories);
  const missing = expectedJellyfinIssueCategories.filter((category) => !actualCategories.has(category));
  const unexpected = actual.issueCategories.filter((category) => !expectedJellyfinIssueCategories.includes(category));
  if (missing.length > 0 || unexpected.length > 0) {
    failures.push(`issue categories missing [${missing.join(', ')}] unexpected [${unexpected.join(', ')}]`);
  }
  return failures;
}
