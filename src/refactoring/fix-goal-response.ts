import { RefactorResponse } from '../devtools-api/refactor-models';
import { ScoreGoalTarget, FixGoalOutput, FixGoalOutcome, FindingGoalTarget, GoalFinding } from './agent-types';
import { Review } from '../devtools-api/review-model';

export function meetsTarget(score: number, operator: string, target: number): boolean {
  if (operator === 'greater-than-or-equal') {
    return score >= target;
  }
  if (operator === 'greater-than') {
    return score > target;
  }
  return false;
}

export function formatScore(score: number): string {
  const rounded = Math.round(score * 100) / 100;
  const twoDecimals = rounded.toFixed(2);
  if (twoDecimals.endsWith('0')) {
    return rounded.toFixed(1);
  }
  return twoDecimals;
}

export function fixGoalCode(output: FixGoalOutput, originalBody: string): string {
  const content = output.whole_file_content;
  if (!content || content.trim() === '') {
    return originalBody;
  }
  const normalized = content.replace(/\r\n/g, '\n');
  if (originalBody.includes('\r\n')) {
    return normalized.replace(/\n/g, '\r\n');
  }
  return normalized;
}

export function fixGoalOutcome(goal: ScoreGoalTarget, reached: number | undefined): FixGoalOutcome {
  if (reached === undefined) {
    return 'unable';
  }
  if (meetsTarget(reached, goal.operator, goal.target)) {
    return 'reached';
  }
  if (reached > goal.baseline) {
    return 'improved';
  }
  return 'unable';
}

export function mapFixGoalResponse(
  output: FixGoalOutput,
  goal: ScoreGoalTarget,
  code: string,
  reached: number | undefined
): RefactorResponse {
  const outcome = fixGoalOutcome(goal, reached);
  const b = formatScore(goal.baseline);
  const r = formatScore(reached ?? goal.baseline);
  const t = formatScore(goal.target);

  let level: number;
  let title: string;
  let reviewHeader: string | undefined;
  let description: string;
  let details: string;

  if (outcome === 'reached') {
    level = 3;
    title = 'Goal reached';
    reviewHeader = 'What was changed';
    description = 'Review the change and accept it to reach the goal.';
    details = `Goal reached: ${b} → ${r} (target ${t})`;
  } else if (outcome === 'improved') {
    level = 2;
    title = 'Improved towards the goal';
    reviewHeader = 'Why the target was not reached';
    description = 'The change improves Code Health but does not reach the target.';
    details = `Improved: ${b} → ${r} (target ${t})`;
  } else {
    level = 1;
    title = 'Unable to improve the file towards the goal';
    reviewHeader = 'Why the target was not reached';
    description = 'The CodeScene Refactoring Agent found no change that improves Code Health.';
    details = output.explanation ?? '';
  }

  const explanationTrimmed = (output.explanation ?? '').trim();
  const reasons = explanationTrimmed ? [{ summary: output.explanation ?? '' }] : [];

  return {
    code,
    confidence: {
      level,
      title,
      'review-header': reviewHeader,
      'recommended-action': {
        description,
        details,
      },
    },
    declarations: undefined,
    metadata: { 'cached?': false },
    reasons,
    'refactoring-properties': {
      'added-code-smells': [],
      'removed-code-smells': [],
    },
    'trace-id': output.task_id,
    'goal-outcome': outcome,
  };
}

const withoutLine = (name: string) => name.replace(/:\d+$/, '');

function smellsAt(review: Review, finding: GoalFinding): string[] {
  const functions = review['function-level-code-smells'].filter(
    (fn) => finding.function === undefined || withoutLine(fn.function) === finding.function
  );
  const fileSmells = finding.function === undefined ? review['file-level-code-smells'] : [];
  return [...fileSmells, ...functions.flatMap((fn) => fn['code-smells'])].map((smell) => smell.category);
}

export function findingOutcome(review: Review, finding: GoalFinding): FixGoalOutcome {
  const present = smellsAt(review, finding);
  const remaining = finding.issues.filter((issue) => present.includes(issue));
  if (remaining.length === 0) return 'reached';
  if (!remaining.includes(finding.issues[0])) return 'improved';
  return 'unable';
}

function findingDetails(finding: GoalFinding, outcome: FixGoalOutcome): string {
  const where = finding.function ? ` in ${finding.function}` : '';
  if (outcome === 'reached') return `Resolved ${finding.issues.join(', ')}${where}`;
  if (outcome === 'improved') return `Resolved ${finding.issues[0]}${where}`;
  return `${finding.issues[0]}${where} remains`;
}

const findingTitles: Record<FixGoalOutcome, string> = {
  reached: 'Goal reached',
  improved: 'Improved towards the goal',
  unable: 'Unable to resolve the finding of the goal',
};

const findingLevels: Record<FixGoalOutcome, number> = { reached: 3, improved: 2, unable: 1 };

export function mapFindingFixResponse(response: RefactorResponse, goal: FindingGoalTarget, outcome: FixGoalOutcome): RefactorResponse {
  return {
    ...response,
    confidence: {
      ...response.confidence,
      level: findingLevels[outcome],
      title: findingTitles[outcome],
      'recommended-action': { ...response.confidence['recommended-action'], details: findingDetails(goal.finding, outcome) },
    },
    'goal-outcome': outcome,
  };
}
