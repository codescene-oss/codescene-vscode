/**
 * Test harness over the CS IDE contract bundle (schemas, wire manifest, fixtures) that
 * scripts/fetch-contract.js unpacks to cs-ide-contract/. Contract tests load fixtures in the
 * form their boundary sees, validate values against the closed JSON schemas and compare
 * what the extension's models declare with what the fixture carries.
 *
 * Every function throws on a violation; nothing is skipped. A missing bundle is a failure, not a skip.
 */
import Ajv, { ValidateFunction } from 'ajv';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

export type Casing = 'kebab' | 'camel';
export type FixtureForm = 'entity' | 'wire';

export interface SchemaRef {
  schema: string;
  definition: string;
  casing: Casing;
  nullable?: boolean;
}

export interface ManifestEntry {
  method?: string;
  kind: string;
  status: 'schematized' | 'unschematized' | 'excluded';
  params?: SchemaRef;
  result?: SchemaRef;
  error?: SchemaRef;
}

type FixtureIndex = Record<string, { schema: string; definition: string; 'wire-casing': Casing; variants: string[] }>;

let contractDir = path.join(__dirname, '..', '..', '..', 'cs-ide-contract');

export function contractRoot(): string {
  if (!fs.existsSync(contractDir) || !fs.statSync(contractDir).isDirectory()) {
    throw new Error(
      `The contract bundle is missing: ${contractDir} does not exist. Run "npm run fetch-contract" ` +
        '(or "npm run pretest"); set CS_IDE_CONTRACT_BUNDLE to use a local bundle.'
    );
  }
  return contractDir;
}

function readJson(relativePath: string): any {
  const file = path.join(contractRoot(), relativePath);
  if (!fs.existsSync(file)) {
    throw new Error(`The contract bundle has no ${relativePath} (${file})`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadManifest(): ManifestEntry[] {
  return readJson('wire-manifest.json');
}

export function manifestEntry(method: string): ManifestEntry {
  const entry = loadManifest().find((candidate) => candidate.method === method);
  if (!entry) {
    throw new Error(`The wire manifest has no entry for ${method}`);
  }
  return entry;
}

/** The fixture of `root` (a key of fixtures/index.json, e.g. "review") and `variant` (e.g. "minimal"), in `form`. */
export function fixture(root: string, variant: string, form: FixtureForm): any {
  const index: FixtureIndex = readJson(path.join('fixtures', 'index.json'));
  const rootInfo = index[root];
  if (!rootInfo) {
    throw new Error(`Unknown fixture root "${root}"; the bundle has: ${Object.keys(index).join(', ')}`);
  }
  if (!rootInfo.variants.includes(variant)) {
    throw new Error(`Fixture root "${root}" has no variant "${variant}"; it has: ${rootInfo.variants.join(', ')}`);
  }
  return readJson(path.join('fixtures', form, root, `${variant}.json`));
}

let ajv: Ajv | undefined;
const validators = new Map<string, ValidateFunction>();

/** Points the harness at another bundle directory (for the harness's own tests); returns the restore function. */
export function useContractDir(directory: string): () => void {
  const previous = contractDir;
  const reset = () => {
    ajv = undefined;
    validators.clear();
  };
  contractDir = directory;
  reset();
  return () => {
    contractDir = previous;
    reset();
  };
}

function validatorFor(schemaFile: string, definition: string): ValidateFunction {
  const key = `${schemaFile}#/definitions/${definition}`;
  const cached = validators.get(key);
  if (cached) {
    return cached;
  }
  const document = readJson(path.join('schemas', schemaFile));
  if (!document.definitions?.[definition]) {
    throw new Error(`Schema ${schemaFile} has no definition "${definition}"`);
  }
  // Draft-07 is Ajv's default; strict mode stays on so a schema keyword Ajv does not know fails loudly.
  ajv ??= new Ajv({ allErrors: true });
  if (!ajv.getSchema(schemaFile)) {
    ajv.addSchema(document, schemaFile);
  }
  const validate = ajv.getSchema(key);
  if (!validate) {
    throw new Error(`Could not compile ${key}`);
  }
  validators.set(key, validate);
  return validate;
}

/**
 * Validates `value` against `definition` of `schemaFile` (a file under schemas/). The schemas are
 * written in kebab-case and closed: an unknown key fails. Camel values go through `toKebabKeys` first.
 */
export function validate(schemaFile: string, definition: string, value: unknown): void {
  const check = validatorFor(schemaFile, definition);
  if (!check(value)) {
    const problems = (check.errors ?? [])
      .map((error) => `  ${error.instancePath || '/'} ${error.message} ${JSON.stringify(error.params)}`)
      .join('\n');
    throw new Error(`Value does not validate against ${schemaFile}#${definition}:\n${problems}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapKeys(value: unknown, rename: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapKeys(item, rename));
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [rename(key), mapKeys(item, rename)]));
  }
  return value;
}

/** The kebab-case form of a camelCase wire value, which is what the schemas are written in. */
export function toKebabKeys(value: unknown): unknown {
  return mapKeys(value, (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
}

const offendingKey: Record<Casing, (key: string) => boolean> = {
  camel: (key) => key.includes('-'),
  kebab: (key) => /[A-Z]/.test(key),
};

function offendingPaths(value: unknown, offends: (key: string) => boolean, location: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => offendingPaths(item, offends, `${location}[${index}]`));
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(offends(key) ? [`${location}.${key}`] : []),
      ...offendingPaths(item, offends, `${location}.${key}`),
    ]);
  }
  return [];
}

/** Every object key at any depth is in `casing`: camel keys have no `-`, kebab keys no uppercase letter. */
export function assertCasing(value: unknown, casing: Casing): void {
  const paths = offendingPaths(value, offendingKey[casing], '$');
  assert.deepStrictEqual(paths, [], `Keys not in ${casing}-case: ${paths.join(', ')}`);
}

function describe(value: unknown): string {
  return value === undefined ? '(absent)' : JSON.stringify(value);
}

function compareAt(expected: unknown, actual: unknown, segments: string[], location: string, problems: string[]): void {
  if (segments.length === 0) {
    if (!isDeepStrictEqual(expected, actual)) {
      problems.push(`${location}: fixture has ${describe(expected)}, entity has ${describe(actual)}`);
    }
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      problems.push(`${location}: fixture has ${expected.length} items, entity has ${actual.length}`);
      return;
    }
    expected.forEach((item, index) => compareAt(item, actual[index], segments, `${location}[${index}]`, problems));
    return;
  }
  const [segment, ...rest] = segments;
  if (!isObject(expected) || !isObject(actual)) {
    if (!isDeepStrictEqual(expected, actual)) {
      problems.push(`${location}: fixture has ${describe(expected)}, entity has ${describe(actual)}`);
    }
    return;
  }
  const expectedHas = Object.prototype.hasOwnProperty.call(expected, segment);
  const actualHas = Object.prototype.hasOwnProperty.call(actual, segment);
  if (!expectedHas && !actualHas) {
    return;
  }
  compareAt(expected[segment], actual[segment], rest, `${location}.${segment}`, problems);
}

function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

/**
 * The D10 comparison: for every field the model declares, the entity serialized back to entity form has
 * exactly what the entity-form `fixture` has. A field the fixture lacks but the entity carries (a default
 * such as `score: 0`), one the fixture has but the entity dropped, and a changed value all fail.
 *
 * `declaredFields` are dotted kebab-case paths from the root of `entity` (e.g. `score`,
 * `function-level-code-smells.range.start-line`); arrays are traversed element by element. A path that
 * ends in an object or array compares that whole value. The paths are not checked against the fixture:
 * a declared optional field is absent from the minimal fixture, and that absence is what is compared.
 */
export function assertDeclaredFieldsMatch(fixtureValue: unknown, entity: unknown, declaredFields: string[]): void {
  // The wire is JSON: what JSON.stringify drops (undefined) is absent, as it would be on the wire.
  const actual: unknown = JSON.parse(JSON.stringify(entity));
  const problems: string[] = [];
  for (const field of declaredFields) {
    compareAt(fixtureValue, actual, field.split('.'), '$', problems);
  }
  assert.deepStrictEqual(problems, [], `Declared fields differ from the fixture:\n  ${problems.join('\n  ')}`);
}
