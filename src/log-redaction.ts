const SECRET_PATTERNS: readonly RegExp[] = [
  /(\bBearer\s+)[^\s"',]+/gi,
  /(\b(?:access|refresh)[-_]token["']?\s*[:=]?\s*["']?)[^\s"',&}]+/gi,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, '$1<redacted>'), text);
}
