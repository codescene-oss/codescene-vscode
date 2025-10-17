
import fs from 'fs';
import path from 'path';
import { ExtensionContext } from 'vscode';

function deleteFilesOlderThan(days: number, folderPath: string) {
  const now = new Date();
  const files = fs.readdirSync(folderPath);
  const daysInMilliseconds = days * 1000 * 60 * 60 * 24;
  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);
    const fileAge = now.getMilliseconds() - stats.mtime.getMilliseconds();
    if (fileAge >= daysInMilliseconds) {
      fs.unlinkSync(filePath);
    }
  });
}

export class ReviewCache {
  private cachePath: string | undefined;

  constructor(context: ExtensionContext) {
    const storagePath = context.storageUri?.fsPath; 
    if (storagePath) {
      const cachePath = path.join(storagePath, ".review-caches");
      this.cachePath = cachePath; 
      if (!fs.existsSync(cachePath)) {
        fs.mkdirSync(cachePath, {recursive: true});
      }
      deleteFilesOlderThan(30, cachePath);
    }
    else {
      this.cachePath = undefined;
    }
  }

  getCachePath(): string | undefined {
    return this.cachePath;
  }
}
