import { isDefined } from '../utils';

/**
 * Creates a valid input string for the delta command.
 * Will return undefined if the old and new score are the same. Used to avoid invoking
 * the delta command.
 *
 * @param oldScore raw base64 encoded score
 * @param newScore raw base64 encoded score
 * @returns
 */
export function jsonForScores(oldScore?: string | void, newScore?: string | void) {
  if (oldScore === newScore) return; // No need to run the delta command if the scores are the same

  const scoreObject = {};
  if (isDefined(oldScore)) {
    Object.assign(scoreObject, { 'old-score': oldScore });
  }
  if (isDefined(newScore)) {
    Object.assign(scoreObject, { 'new-score': newScore });
  }

  if (Object.keys(scoreObject).length === 0) return; // if both are undefined the delta command will fail

  return JSON.stringify(scoreObject);
}
