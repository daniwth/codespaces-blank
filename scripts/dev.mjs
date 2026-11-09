// `npm run dev`: account server (:8787) and Vite together, so the Account menu works out of the box.
import { spawn } from 'node:child_process';

const procs = [
  ['server', process.execPath, ['--no-warnings', '--env-file-if-exists=.env', 'server/index.ts']],
  ['web', process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)]],
].map(([name, cmd, args]) => {
  const child = spawn(cmd, args, { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code ?? 'signal'}); stopping the rest.`);
    shutdown(code ?? 1);
  });
  return child;
});

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  procs.forEach((p) => p.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
