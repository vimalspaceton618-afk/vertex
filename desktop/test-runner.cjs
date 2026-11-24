const { spawn } = require('node:child_process');
function runTest(root, command, { timeout = 120000, maxBytes = 512000 } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\0\r\n]/.test(command)) throw new Error('Enter a single test command of up to 2,000 characters.');
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, reason = null;
    const stop = why => {
      if (reason) return;
      reason = why;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const collect = chunk => {
      const remaining = Math.max(0, maxBytes - bytes);
      output += chunk.subarray(0, remaining).toString(); bytes += chunk.length;
      if (bytes > maxBytes) stop('Output limit reached');
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => stop('Time limit reached'), timeout);
    child.on('error', error => { reason = error.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ command, cwd: root, output, exitCode, signal, reason, durationMs: Date.now() - started });
    });
  });
}
module.exports = { runTest };
