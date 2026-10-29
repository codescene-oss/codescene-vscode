export interface BenchBinary {
  binaryPath: string;
  args: string[];
}

export function resolveBenchBinary(
  env: NodeJS.ProcessEnv,
  exists: (binaryPath: string) => boolean
): BenchBinary | undefined {
  const binaryPath = env.CS_BENCH_BIN;
  if (!binaryPath) return undefined;
  if (!exists(binaryPath)) throw new Error(`CS_BENCH_BIN not found at ${binaryPath}`);
  return { binaryPath, args: ['server'] };
}
