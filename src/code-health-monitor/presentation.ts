import { Delta } from '../devtools-api/delta-model';
import { formatScore } from '../review/utils';

export function scorePresentation(delta: Delta) {
  if (delta['old-score'] === delta['new-score']) return formatScore(delta['old-score']);
  const oldScorePresentation = delta['old-score'] || 'n/a';
  const newScorePresentation = delta['new-score'] || 'n/a';
  return `${oldScorePresentation} → ${newScorePresentation}`;
}
