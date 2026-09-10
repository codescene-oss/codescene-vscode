import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IGNORED_DIRECTORIES } from '../review/ignored_dirs';

const FIXTURE_REMOTE = 'https://github.com/spring-projects/spring-framework.git';
const FIXTURE_COMMIT = '68338aa81891eb43afff7d6da9ad9b23c4db747e';
const BASELINE_BRANCH = 'main';
const WORK_BRANCH = 'bench';
const MIN_SOURCE_BYTES = 2048;
const MAX_SOURCE_BYTES = 65536;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const SALT_STRIDE = 1000;

export interface FixtureFile {
  relPath: string;
  content: string;
}

interface SourceEntry {
  relPath: string;
  size: number;
}

/**
 * The extension never reviews files under directories it considers generated, so picking them for
 * the change set would measure nothing.
 */
function isReviewable(relPath: string): boolean {
  return !relPath.split('/').some((segment) => IGNORED_DIRECTORIES.includes(segment));
}

export function fixtureRoot(): string {
  return (
    process.env.CS_BENCH_FIXTURE_PATH ?? path.join(os.homedir(), '.codescene-bench-data', 'spring-framework')
  );
}

export function benchmarkMethod(index: number): string {
  return `
    public int csBenchmarkComplexOperation${index}(int a, int b, int c, int d, int e, int f, int g, int h) {
        int result = 0;
        if (a > b) {
            if (b > c) {
                if (c > d) {
                    if (d > e && e > f || f > g && g > h) {
                        for (int i = 0; i < a; i++) {
                            if (i % 2 == 0 && i > c) {
                                result += i * b - c;
                            } else if (i % 3 == 0 || i < d) {
                                result -= i + e;
                            } else {
                                result = result * 2 - f;
                            }
                        }
                    } else if (e > f) {
                        result = a + b + c + d + e + f + g + h;
                    } else {
                        result = a - b - c - d;
                    }
                } else {
                    result = c > 0 ? c * d : d * e;
                }
            } else {
                while (result < h && result < g) {
                    result += b > 0 ? b : 1;
                }
            }
        } else if (b > c || c > d) {
            switch (a % 4) {
                case 0: result = a; break;
                case 1: result = b; break;
                case 2: result = c; break;
                default: result = d; break;
            }
        }
        return result;
    }
`;
}

export function injectSmells(content: string, methodCount: number, salt = 0): string {
  const methods = Array.from({ length: methodCount }, (_, index) =>
    benchmarkMethod(salt * SALT_STRIDE + index)
  ).join('');
  const insertAt = content.lastIndexOf('}');
  if (insertAt < 0) return `${content}${methods}`;
  return `${content.slice(0, insertAt)}${methods}${content.slice(insertAt)}`;
}

export class FixtureRepo {
  private sources?: SourceEntry[];

  constructor(readonly root: string = fixtureRoot()) {}

  get baselineBranch(): string {
    return BASELINE_BRANCH;
  }

  get workBranch(): string {
    return WORK_BRANCH;
  }

  prepare(): void {
    if (fs.existsSync(path.join(this.root, '.git'))) {
      this.reset();
      return;
    }
    fs.mkdirSync(this.root, { recursive: true });
    this.git('init', '--initial-branch', BASELINE_BRANCH);
    this.git('config', 'user.email', 'benchmarks@codescene.io');
    this.git('config', 'user.name', 'CodeScene Benchmarks');
    this.git('config', 'gc.auto', '0');
    this.git('config', 'core.autocrlf', 'false');
    this.git('remote', 'add', 'origin', FIXTURE_REMOTE);
    this.git('fetch', '--depth', '1', 'origin', FIXTURE_COMMIT);
    this.git('checkout', '-B', BASELINE_BRANCH, 'FETCH_HEAD');
    this.writeCodesceneConfig();
    this.git('add', '--force', '.codescene/config.json');
    this.git('commit', '-m', 'benchmark fixture configuration');
    this.git('checkout', '-B', WORK_BRANCH);
    this.updateBaselineRefs();
  }

  reset(): void {
    try {
      this.resetTree();
    } catch {
      this.clearStaleLock();
      this.resetTree();
    }
  }

  private resetTree(): void {
    this.git('stash', 'clear');
    this.git('checkout', '-f', BASELINE_BRANCH);
    this.git('reset', '--hard', BASELINE_BRANCH);
    this.git('branch', '-f', WORK_BRANCH, BASELINE_BRANCH);
    this.git('checkout', '-f', WORK_BRANCH);
    this.git('clean', '-fdq');
    this.updateBaselineRefs();
  }

  changedFiles(count: number, salt = 0, methodCount = 1): FixtureFile[] {
    return this.sourceFiles(count).map((relPath) => ({
      relPath,
      content: injectSmells(this.read(relPath), methodCount, salt),
    }));
  }

  bigSmellyFile(methodCount: number, salt = 0): FixtureFile {
    const relPath = this.largestSourceFile();
    return { relPath, content: injectSmells(this.read(relPath), methodCount, salt) };
  }

  sourceFiles(count: number): string[] {
    const candidates = this.allSources().filter(
      (entry) => entry.size >= MIN_SOURCE_BYTES && entry.size <= MAX_SOURCE_BYTES
    );
    if (candidates.length < count) {
      throw new Error(`Fixture repo only has ${candidates.length} eligible source files, needed ${count}`);
    }
    return candidates.slice(0, count).map((entry) => entry.relPath);
  }

  largestSourceFile(): string {
    const sources = this.allSources();
    return sources.reduce((largest, entry) => (entry.size > largest.size ? entry : largest)).relPath;
  }

  read(relPath: string): string {
    return fs.readFileSync(path.join(this.root, relPath), 'utf8');
  }

  writeFiles(files: FixtureFile[]): void {
    for (const file of files) {
      fs.writeFileSync(path.join(this.root, ...file.relPath.split('/')), file.content);
    }
  }

  commitAll(message: string): void {
    this.git('add', '--all');
    this.git('commit', '-m', message);
  }

  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.root,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private allSources(): SourceEntry[] {
    if (this.sources) return this.sources;
    const listed = this.git('ls-files', '*.java')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isReviewable(line));
    const entries = listed
      .map((relPath) => {
        const stats = fs.statSync(path.join(this.root, relPath), { throwIfNoEntry: false });
        return { relPath, size: stats?.size ?? 0 };
      })
      .filter((entry) => entry.size > 0)
      .sort((left, right) => left.relPath.localeCompare(right.relPath));
    this.sources = entries;
    return entries;
  }

  /**
   * The CLI runs its own git commands against the fixture and can leave the index locked when it is
   * shut down mid operation. The fixture is disposable and owned by the harness, so clearing the
   * lock is safe here.
   */
  private clearStaleLock(): void {
    try {
      fs.rmSync(path.join(this.root, '.git', 'index.lock'), { force: true });
    } catch {
      return;
    }
  }

  /**
   * The CLI resolves the baseline through the remote tracking refs a real clone would have. Without
   * them it falls back to HEAD and committed changes never enter the change set.
   */
  private updateBaselineRefs(): void {
    this.git('update-ref', `refs/remotes/origin/${BASELINE_BRANCH}`, this.git('rev-parse', BASELINE_BRANCH).trim());
    this.git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${BASELINE_BRANCH}`);
  }

  private writeCodesceneConfig(): void {
    const configDir = path.join(this.root, '.codescene');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      `${JSON.stringify({ baseline_branch: BASELINE_BRANCH }, null, 2)}\n`
    );
  }
}
