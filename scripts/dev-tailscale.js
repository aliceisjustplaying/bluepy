import { spawn } from 'child_process';

const port = process.env.PORT || process.env.VITE_PORT || '5173';

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = run(command, args);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

let vite;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await runOnce('tailscale', ['serve', '--https=443', 'off']);
  } catch {}
  if (vite && !vite.killed) vite.kill(signal || 'SIGTERM');
}

process.on('SIGINT', () => {
  shutdown('SIGINT').then(() => process.exit(130));
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM').then(() => process.exit(143));
});

try {
  await runOnce('tailscale', ['serve', '--bg', '--https=443', port]);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

vite = run('vite', ['--host', '127.0.0.1']);
vite.on('error', async (err) => {
  console.error(err.message);
  await shutdown();
  process.exit(1);
});
vite.on('exit', async (code, signal) => {
  await shutdown();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code || 0);
});
