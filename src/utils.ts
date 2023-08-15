export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

// Finds the column range of the function name in the line of code that it appears in
export function getFunctionNameRange(line: string, functionName: string): [number, number] {
  const functionNameIndex = line.indexOf(functionName);
  if (functionNameIndex === -1) {
    const periodIndex = functionName.indexOf('.');
    if (periodIndex !== -1) {
      // Try again with the function name without the class name
      const functionNameWithoutClass = functionName.slice(periodIndex + 1);
      return getFunctionNameRange(line, functionNameWithoutClass);
    }
    return [0, 0];
  }
  return [functionNameIndex, functionNameIndex + functionName.length];
}

export function getFileNameWithoutExtension(filename: string) {
  const index = filename.lastIndexOf('.');
  return filename.slice(0, index > 0 ? index : filename.length);
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

export function difference<T>(a: Set<T>, b: Set<T>) {
  return new Set([...a].filter((x) => !b.has(x)));
}