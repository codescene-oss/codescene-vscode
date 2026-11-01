import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

const { extractZipArchive } = require('../../../scripts/extract-zip');

interface ZipEntry {
  name: string;
  data: string;
  unixMode?: number;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x031e, 4);
    header.writeUInt16LE(10, 6);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));
    parts.push(local, name, data);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDirectory, end]);
}

suite('Extract Zip Script Test Suite', () => {
  const directories: string[] = [];

  function tempDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-extract-zip-'));
    directories.push(directory);
    return directory;
  }

  function writeZip(entries: ZipEntry[]): string {
    const zipPath = path.join(tempDir(), 'archive.zip');
    fs.writeFileSync(zipPath, buildZip(entries));
    return zipPath;
  }

  teardown(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('extracts nested files and creates the destination directory', async () => {
    const zipPath = writeZip([
      { name: 'index.html', data: '<html></html>' },
      { name: 'assets/index.js', data: 'console.log(1);' },
    ]);
    const destination = path.join(tempDir(), 'out', 'nested');

    await extractZipArchive(zipPath, destination);

    assert.strictEqual(fs.readFileSync(path.join(destination, 'index.html'), 'utf8'), '<html></html>');
    assert.strictEqual(fs.readFileSync(path.join(destination, 'assets', 'index.js'), 'utf8'), 'console.log(1);');
  });

  test('rejects an archive that has not been created', async () => {
    const destination = tempDir();
    await assert.rejects(extractZipArchive(path.join(destination, 'missing.zip'), destination));
  });

  const symlinkCases = [
    { description: 'a symlink pointing outside the destination', target: '../outside', accepted: false },
    { description: 'an absolute symlink pointing outside the destination', target: os.tmpdir(), accepted: false },
    { description: 'a symlink staying inside the destination', target: 'real.txt', accepted: true },
  ];

  for (const { description, target, accepted } of symlinkCases) {
    test(`${accepted ? 'keeps' : 'rejects'} ${description}`, async function () {
      if (process.platform === 'win32') {
        this.skip();
      }
      const zipPath = writeZip([
        { name: 'real.txt', data: 'content' },
        { name: 'link', data: target, unixMode: 0o120777 },
      ]);
      const destination = path.join(tempDir(), 'out');

      const extraction = extractZipArchive(zipPath, destination);

      if (accepted) {
        await extraction;
        assert.strictEqual(fs.readlinkSync(path.join(destination, 'link')), target);
      } else {
        await assert.rejects(extraction, /links outside the extraction directory/);
      }
    });
  }
});
