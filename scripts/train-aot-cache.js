#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NATIVE_ACCESS_FLAG = '--enable-native-access=ALL-UNNAMED';
const TRAIN_HEAP_FLAG = '-Xmx512m';
const TRAIN_THREADS = '2';
const CACHE_FILE_NAME = 'cs-ide.aot';
const MIN_CACHE_BYTES = 1024 * 1024;
const START_TIMEOUT_MS = 60000;
const SHUTDOWN_TIMEOUT_MS = 120000;
const TRAINING_REVIEW_PATH = 'some.js';
const TRAINING_REVIEW_SOURCE =
  'const func = (item, a, b, c, d, e, f) => {\n' +
  '  if (a === "!" && a === "?" && a === "!?" && a.color === "abc") {\n' +
  '    console.log("f: " + f);\n' +
  '  }\n' +
  '};\n';

function cachePath(jar) {
  return path.join(path.dirname(jar), CACHE_FILE_NAME);
}

function trainCommand({ java, jar, cachePath: cache }) {
  return [
    java,
    TRAIN_HEAP_FLAG,
    NATIVE_ACCESS_FLAG,
    `-XX:AOTCacheOutput=${cache}`,
    '-jar',
    jar,
    'server',
    '--threads',
    TRAIN_THREADS,
  ];
}

function productionCommand({ java, jar, cachePath: cache }) {
  return [java, NATIVE_ACCESS_FLAG, `-XX:AOTCache=${cache}`, '-jar', jar, 'server', '--threads', TRAIN_THREADS];
}

function resolvePaths(projectRoot = path.join(__dirname, '..')) {
  const dist = path.join(projectRoot, `cs-${process.platform}-${process.arch}`);
  const java = path.join(dist, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const jar = path.join(dist, 'cs-ide.jar');
  return { java, jar, cachePath: cachePath(jar), dist };
}

function writeRpc(stream, message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  stream.write(`Content-Length: ${body.length}\r\n\r\n`);
  stream.write(body);
}

class RpcReader {
  constructor(stream) {
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    stream.on('data', (chunk) => this.push(chunk));
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  drain() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.slice(start, start + length).toString('utf8');
      this.buffer = this.buffer.slice(start + length);
      const message = JSON.parse(body);
      if (this.waiters.length) this.waiters.shift()(message);
      else this.messages.push(message);
    }
  }

  next(timeoutMs) {
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for JSON-RPC after ${timeoutMs}ms`)),
        timeoutMs
      );
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }
}

function killTree(proc) {
  if (!proc.pid || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    // ignore
  }
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function runSession(command, { review }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    const stderrChunks = [];
    proc.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });
    const reader = new RpcReader(proc.stdout);
    const startedAt = Date.now();
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      killTree(proc);
      reject(error);
    };

    proc.on('error', fail);

    (async () => {
      while (true) {
        const remaining = START_TIMEOUT_MS - (Date.now() - startedAt);
        if (remaining <= 0) throw new Error('cs-ide server never sent cs-ide/start');
        const message = await reader.next(remaining);
        if (message.method === 'cs-ide/start') break;
      }
      const handshakeMs = Date.now() - startedAt;
      if (review) {
        writeRpc(proc.stdin, {
          jsonrpc: '2.0',
          id: 1,
          method: 'cs-ide/review',
          params: { path: TRAINING_REVIEW_PATH, 'file-content': TRAINING_REVIEW_SOURCE },
        });
        while (true) {
          const message = await reader.next(START_TIMEOUT_MS);
          if (message.id === 1) break;
        }
      }
      proc.stdin.end();
      const exited = await waitForExit(proc, SHUTDOWN_TIMEOUT_MS);
      if (!exited) {
        killTree(proc);
        throw new Error('cs-ide did not exit after stdin close; AOT cache was not dumped');
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (proc.exitCode !== 0) {
        throw new Error(`cs-ide exited ${proc.exitCode}: ${stderr}`);
      }
      return { handshakeMs, stderr };
    })().then((result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    }, fail);
  });
}

async function train(paths) {
  if (fs.existsSync(paths.cachePath)) fs.unlinkSync(paths.cachePath);
  const trained = await runSession(trainCommand(paths), { review: true });
  if (!fs.existsSync(paths.cachePath)) throw new Error('AOT cache file was not created');
  const cacheBytes = fs.statSync(paths.cachePath).size;
  if (cacheBytes < MIN_CACHE_BYTES) throw new Error(`AOT cache too small: ${cacheBytes} bytes`);
  return { ...trained, cacheBytes, cachePath: paths.cachePath };
}

function verifyHandshake(paths) {
  return runSession(productionCommand(paths), { review: false });
}

async function main() {
  const paths = resolvePaths();
  if (!fs.existsSync(paths.java) || !fs.existsSync(paths.jar)) {
    throw new Error(`no cs-ide distribution at ${paths.dist}`);
  }
  console.log('Training AOT cache with', paths.java, '-jar', paths.jar);
  const trained = await train(paths);
  console.log(
    `Wrote ${trained.cachePath} (${(trained.cacheBytes / 1024 / 1024).toFixed(1)} MB) train handshake ${trained.handshakeMs} ms`
  );
  const verified = await verifyHandshake(paths);
  console.log(`Cached handshake ${verified.handshakeMs} ms`);
}

module.exports = {
  trainCommand,
  productionCommand,
  cachePath,
  resolvePaths,
  train,
  verifyHandshake,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
