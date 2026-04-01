/**
 * Thin wrapper around `vitest run` that appends a clean summary line
 * at the very end of the output, e.g.:
 *
 *   ✓  263 / 263 tests passed
 *   ✗  241 / 263 tests passed  (22 failed)
 *
 * Uses vitest's built-in JSON reporter to capture machine-readable results,
 * then exits with vitest's original exit code so CI still fails correctly.
 */

import { spawnSync } from 'child_process';
import { readFileSync, rmSync } from 'fs';

const RESULTS_FILE = '.vitest-results.json';

const { status } = spawnSync(
  'npx',
  [
    'vitest', 'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${RESULTS_FILE}`,
  ],
  { stdio: 'inherit', shell: true }
);

// Print the summary line regardless of pass/fail.
try {
  const { numTotalTests, numPassedTests, numFailedTests } = JSON.parse(
    readFileSync(RESULTS_FILE, 'utf8')
  );
  const ok      = numFailedTests === 0;
  const icon    = ok ? '✓' : '✗';
  const failed  = ok ? '' : `  (${numFailedTests} failed)`;
  console.log(`\n${icon}  ${numPassedTests} / ${numTotalTests} tests passed${failed}`);
} catch {
  // JSON file missing (e.g. vitest crashed before writing) — skip summary.
} finally {
  try { rmSync(RESULTS_FILE); } catch { /* ignore */ }
}

process.exit(status ?? 1);
