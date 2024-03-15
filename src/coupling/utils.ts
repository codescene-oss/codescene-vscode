/**
 * Rank name by how well they match the argument `match`.
 */
export function rankNamesBy(match: string, names: string[]): void {
  let matchLower = match.toLowerCase();
  names.sort((a: string, b: string) => {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();

    const isMatch = (match: string, s: string) => {
      return match.includes(s) || s.includes(match);
    };

    if (isMatch(matchLower, al) && !isMatch(matchLower, bl)) {
      return -1;
    } else if (!isMatch(matchLower, al) && isMatch(matchLower, bl)) {
      return 1;
    }
    return 0;
  });
}

export function groupByProperty<T>(arr: T[], property: keyof T): { [k: string]: T[] } {
  const result: { [k: string]: T[] } = {};

  for (const obj of arr) {
    const key = String(obj[property]);

    if (key in result) {
      result[key].push(obj);
    } else {
      result[key] = [obj];
    }
  }

  return result;
}

export function difference<T>(a: Set<T>, b: Set<T>) {
  return new Set([...a].filter((x) => !b.has(x)));
}
