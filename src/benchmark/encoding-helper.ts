import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { FixtureFile } from './fixture-repo';

export const pinnedEncodingHelperSha256 = 'd2fa5f50afd302ff776ed9d7ac4a8500a7fd740d44a8c7f17cae58ccaa152980';
export const pinnedEncodingHelperBytes = 358293;
export const pinnedEncodingHelperLines = 8093;

const encodingHelperUrl =
  'https://raw.githubusercontent.com/mrksbrg/jellyfin/8a93a627c4ad9bba99f607bed6a3e40e619481fc/MediaBrowser.Controller/MediaEncoding/EncodingHelper.cs';
const encodingHelperName = 'EncodingHelper.cs';
const jellyfinRelPath = 'MediaBrowser.Controller/MediaEncoding/EncodingHelper.cs';

export function encodingHelperDir(): string {
  return process.env.CS_BENCH_DATA ?? path.join(os.homedir(), '.codescene-bench-data');
}

function lineCount(bytes: Buffer): number {
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (text.length === 0) return 0;
  const withoutTrailingNewline = text.endsWith('\n') ? text.slice(0, -1) : text;
  return withoutTrailingNewline.split('\n').length;
}

export function assertPinnedEncodingHelper(bytes: Buffer): void {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const lines = lineCount(bytes);
  const pinMatches =
    hash === pinnedEncodingHelperSha256 && bytes.length === pinnedEncodingHelperBytes && lines === pinnedEncodingHelperLines;
  if (!pinMatches) {
    throw new Error(`EncodingHelper.cs pin mismatch: sha256 ${hash} bytes ${bytes.length} lines ${lines}`);
  }
}

export function measuredEncodingHelper(source: string, iteration: number): string {
  return `${source}\n// cs-bench-iteration ${iteration}\n`;
}

export function jellyfinFixtureFile(source: string, iteration: number | 'exact'): FixtureFile {
  return {
    relPath: jellyfinRelPath,
    content: iteration === 'exact' ? source : measuredEncodingHelper(source, iteration),
  };
}

function redirectTarget(status: number, location?: string): string | undefined {
  if (status < 300 || status >= 400) return undefined;
  return location;
}

function fetchEncodingHelper(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const status = response.statusCode ?? 0;
        const redirect = redirectTarget(status, response.headers.location);
        if (redirect) {
          response.resume();
          fetchEncodingHelper(redirect).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`EncodingHelper download failed: ${status} ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

export async function readPinnedEncodingHelper(
  root: string,
  readUrl: (url: string) => Promise<Buffer> = fetchEncodingHelper,
  pinCheck: (bytes: Buffer) => void = assertPinnedEncodingHelper
): Promise<string> {
  const filePath = path.join(root, encodingHelperName);
  if (fs.existsSync(filePath)) {
    const existing = await fs.promises.readFile(filePath);
    pinCheck(existing);
    return existing.toString('utf8');
  }
  const downloaded = await readUrl(encodingHelperUrl);
  pinCheck(downloaded);
  fs.mkdirSync(root, { recursive: true });
  await fs.promises.writeFile(filePath, downloaded);
  return downloaded.toString('utf8');
}
