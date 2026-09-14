// Compatibility entrypoint. All production Worker releases use the universal gate.
import { runCli } from './worker-release.mjs';

try { await runCli(['--worker', 'nurture-engine', ...process.argv.slice(2)]); } catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
