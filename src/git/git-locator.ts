import { execFile } from 'child_process';
import { access, constants } from 'fs/promises';
import { join, normalize } from 'path';

export class GitLocator {
  private static cachedGitPath: string | null = null;

  private static isWindows(): boolean {
    return process.platform === 'win32';
  }

  static locate(): Promise<string> {
    if (this.cachedGitPath) {
      return Promise.resolve(this.cachedGitPath);
    }

    const isWindows = this.isWindows();
    const command = isWindows ? 'where' : 'which';

    return new Promise((resolve, reject) => {
      execFile(command, ['git'], async (error, stdout) => {
        if (!error) {
          const candidates = stdout.trim().split('\n').map(p => p.trim()).filter(p => p);

          // Filter out non-executable binaries
          const executableGit = await this.findFirstExecutable(candidates);
          if (executableGit) {
            const normalizedPath = normalize(executableGit);
            this.cachedGitPath = normalizedPath;
            resolve(normalizedPath);
            return;
          }
        }

        // Git not found via where/which, try Windows registry lookup if applicable
        if (isWindows) {
          this.locateGitViaWindowsRegistry().then(resolve).catch(reject);
        } else {
          reject(error || new Error('Git binary not found in PATH'));
        }
      });
    });
  }

  private static async findFirstExecutable(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      if (await this.isExecutable(path)) {
        return path;
      }
    }
    return null;
  }

  private static async isExecutable(filePath: string): Promise<boolean> {
    try {
      // On Windows, check if file exists and is readable (Windows doesn't have execute bit)
      // On Unix-like systems, check if file has execute permission
      const mode = this.isWindows() ? constants.F_OK | constants.R_OK : constants.X_OK;
      await access(filePath, mode);
      return true;
    } catch {
      return false;
    }
  }

  private static async locateGitViaWindowsRegistry(): Promise<string> {
    // Try system PATH first
    const systemPaths = await this.getRegistryPathsAsync('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
    const gitInSystem = await this.findGitInWindowsPathsAsync(systemPaths);
    if (gitInSystem) {
      const normalizedPath = normalize(gitInSystem);
      this.cachedGitPath = normalizedPath;
      return normalizedPath;
    }

    // If not found, try user PATH
    const userPaths = await this.getRegistryPathsAsync('HKCU\\Environment');
    const gitInUser = await this.findGitInWindowsPathsAsync(userPaths);
    if (gitInUser) {
      const normalizedPath = normalize(gitInUser);
      this.cachedGitPath = normalizedPath;
      return normalizedPath;
    }

    throw new Error('Git binary not found in system PATH registry');
  }

  private static getRegistryPathsAsync(registryKey: string): Promise<string[]> {
    return new Promise((resolve) => {
      this.getRegistryPaths(registryKey, resolve);
    });
  }

  private static findGitInWindowsPathsAsync(paths: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      this.findGitInWindowsPaths(paths, resolve);
    });
  }

  private static getRegistryPaths(registryKey: string, callback: (paths: string[]) => void): void {
    // Query the Windows registry for the Path value
    execFile('reg', ['query', registryKey, '/v', 'Path'], (error, stdout) => {
      if (error) {
        callback([]);
        return;
      }

      // Parse the registry output format:
      // Example REG_SZ:        "Path    REG_SZ         C:\path1;C:\path2"
      // Example REG_EXPAND_SZ: "Path    REG_EXPAND_SZ  C:\Windows\system32;%USERPROFILE%\bin"
      // Regex breakdown: Path\s+ (literal "Path" followed by whitespace), REG_(?:EXPAND_)?SZ (REG_SZ or REG_EXPAND_SZ, non-capturing group), \s+ (whitespace), (.+) (capture the path value)
      // REG_SZ: a string type in Windows registry
      // REG_EXPAND_SZ: a string type that can contain unexpanded environment variable references (e.g., %USERPROFILE%)
      const match = stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      const pathValue = match ? match[1].trim() : '';
      // Filter out paths containing unexpanded environment variables (e.g., %USERPROFILE%)
      const paths = pathValue.split(';').filter(p => p.trim() && !p.includes('%'));
      callback(paths);
    });
  }

  private static findGitInWindowsPaths(paths: string[], callback: (gitPath: string | null) => void): void {
    if (paths.length === 0) {
      callback(null);
      return;
    }

    let index = 0;

    const checkNext = () => {
      if (index >= paths.length) {
        callback(null);
        return;
      }

      const dir = paths[index];
      const gitPath = join(dir.trim(), 'git.exe');
      index++;

      // Check if git.exe exists and is executable
      this.isExecutable(gitPath)
        .then((executable) => {
          if (executable) {
            callback(normalize(gitPath));
          } else {
            checkNext();
          }
        })
        .catch(() => {
          checkNext();
        });
    };

    checkNext();
  }
}
