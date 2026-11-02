/** `scoreChange` -> `score-change`, `HTTPStatus` -> `http-status`; kebab-case and other keys are unchanged. */
export function kebabCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The kebab-case form of every key of `value`, at any depth (arrays included). The cs-ide protocol takes
 * kebab-case keys; free-form data such as telemetry event properties is converted here instead of at each
 * place that builds it. Values that are not plain objects or arrays (strings, dates, class instances) are kept.
 */
export function kebabKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(kebabKeys) as T;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [kebabCase(key), kebabKeys(item)])) as T;
}
