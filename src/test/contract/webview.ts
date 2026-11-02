/**
 * Test harness over the schemas of the bundled webview (CWF) zip, which `npm run updatecwf` unpacks to cs-cwf/:
 * `webview-schema.json` (what the extension sends to the webview, rooted at `IdeContextType`) and
 * `message-schema.json` (what the webview sends to the extension, rooted at `MessageToIDEType`).
 * Both are closed (`additionalProperties: false` on every object), so an undeclared field fails.
 *
 * Every function throws on a violation; nothing is skipped. A missing schema file is a failure, not a skip.
 */
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';

export const WEBVIEW_SCHEMA = 'webview-schema.json';
export const MESSAGE_SCHEMA = 'message-schema.json';

const MAX_REPORTED_ERRORS = 12;

let cwfDir = path.join(__dirname, '..', '..', '..', 'cs-cwf');
const validators = new Map<string, ValidateFunction>();
const branchValidators = new Map<string, ValidateFunction[]>();

/** Points the harness at another CWF directory (for the harness's own tests); returns the restore function. */
export function useCwfDir(directory: string): () => void {
  const previous = cwfDir;
  const reset = () => {
    validators.clear();
    branchValidators.clear();
  };
  cwfDir = directory;
  reset();
  return () => {
    cwfDir = previous;
    reset();
  };
}

function readSchema(name: string): any {
  const file = path.join(cwfDir, name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `The webview schema ${name} is missing: ${file} does not exist. Run "npm run updatecwf" ` +
        '(it needs GITHUB_TOKEN with access to empear-analytics/cs-webview unless ../cs-webview is checked out).'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validatorFor(name: string): ValidateFunction {
  const cached = validators.get(name);
  if (cached) {
    return cached;
  }
  // Draft-07 is Ajv's default; strict mode stays on so a schema keyword Ajv does not know fails loudly.
  const validate = new Ajv({ allErrors: true }).compile(readSchema(name));
  validators.set(name, validate);
  return validate;
}

function branchValidatorsFor(name: string): ValidateFunction[] {
  const cached = branchValidators.get(name);
  if (cached) {
    return cached;
  }
  const document = readSchema(name);
  const ajv = new Ajv({ allErrors: true });
  const branches: ValidateFunction[] = (document.anyOf ?? []).map((branch: object) =>
    ajv.compile({ ...branch, definitions: document.definitions })
  );
  branchValidators.set(name, branches);
  return branches;
}

/**
 * Both schemas are a root `anyOf` over the views / message types, so Ajv reports the errors of every branch.
 * The ones worth reading are those of the branch the value comes closest to: the one with the fewest errors.
 */
function closestBranchErrors(name: string, value: unknown, allErrors: ErrorObject[]): ErrorObject[] {
  let closest = allErrors;
  for (const validate of branchValidatorsFor(name)) {
    if (!validate(value) && (validate.errors ?? []).length < closest.length) {
      closest = [...(validate.errors ?? [])];
    }
  }
  return closest;
}

function describeErrors(errors: ErrorObject[]): string {
  const lines = errors
    .slice(0, MAX_REPORTED_ERRORS)
    .map((error) => `  ${error.instancePath || '/'} ${error.message} ${JSON.stringify(error.params)}`);
  const omitted = errors.length - lines.length;
  return (omitted > 0 ? [...lines, `  ... and ${omitted} more`] : lines).join('\n');
}

function check(name: string, value: unknown): void {
  const validate = validatorFor(name);
  if (!validate(value)) {
    const errors = closestBranchErrors(name, value, validate.errors ?? []);
    throw new Error(`Value does not validate against ${name}:\n${describeErrors(errors)}`);
  }
}

/** `payload` (props of a webview view, or the payload of an `update-renderer` message) is a valid `IdeContextType`. */
export function validateWebviewPayload(payload: unknown): void {
  check(WEBVIEW_SCHEMA, payload);
}

/** `message` (as the webview posts it to the extension) is a valid `MessageToIDEType`. */
export function validateWebviewMessage(message: unknown): void {
  check(MESSAGE_SCHEMA, message);
}
