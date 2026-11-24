const { randomUUID } = require('node:crypto');
const { open, lstat, realpath, rename, unlink } = require('node:fs/promises');
const { dirname, extname, isAbsolute, join, relative, sep } = require('node:path');

const sourceExtensions = new Set('.js .jsx .cjs .mjs .ts .tsx .cts .mts .py .rs .go .c .cpp .h .hpp .java .cs .html .css .md'.split(' '));
const maxBytes = 24_000;

async function readSource(workspace, file) {
  const root = await realpath(workspace);
  const name = relative(root, file);
  if (!name || isAbsolute(name) || name === '..' || name.startsWith('..' + sep) ||
      name.split(sep).some(part => part.startsWith('.')) ||
      !sourceExtensions.has(extname(name).toLowerCase())) {
    throw new Error('Select a supported source file inside the workspace.');
  }
  if (await realpath(file) !== join(root, name)) throw new Error('Linked source paths are unsupported.');
  const before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) {
    throw new Error('Select a regular source file under 24 KB.');
  }
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1) {
      throw new Error('The selected source path changed.');
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead > maxBytes || bytesRead !== after.size || after.mtimeMs !== stat.mtimeMs ||
        buffer.subarray(0, bytesRead).includes(0) ||
        await realpath(file) !== join(root, name)) {
      throw new Error('The file changed or is not a supported text file.');
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead));
    return { root, name, file, text, stat };
  } finally {
    await handle.close();
  }
}

function previewEdit(source, response) {
  let data;
  try {
    data = JSON.parse(response);
  } catch {
    throw new Error('DeepSeek did not return a valid edit. Try a more specific task.');
  }
  if (typeof data?.find !== 'string' || !data.find || typeof data.replace !== 'string') {
    throw new Error('DeepSeek did not return a usable edit.');
  }
  const eol = source.includes('\r\n') && !source.replaceAll('\r\n', '').includes('\n') ? '\r\n' : '\n';
  const normalize = value => value.replace(/\r?\n/g, eol);
  const find = normalize(data.find);
  const replacement = normalize(data.replace);
  const start = source.indexOf(find);
  if (start < 0 || source.indexOf(find, start + 1) >= 0 || find === replacement ||
      replacement.includes('\0')) {
    throw new Error('The proposed edit does not match one unique section of the source.');
  }
  const updated = source.slice(0, start) + replacement + source.slice(start + find.length);
  if (Buffer.byteLength(updated) > maxBytes) throw new Error('The proposed edit exceeds the file size limit.');
  return { find, replacement, updated, summary: typeof data.summary === 'string' ? data.summary.slice(0, 2000) : '' };
}

async function applyEdit(snapshot, edit) {
  const assertUnchanged = async () => {
    const current = await readSource(snapshot.root, snapshot.file);
    if (current.text !== snapshot.text || current.stat.ino !== snapshot.stat.ino ||
        current.stat.dev !== snapshot.stat.dev || current.stat.mode !== snapshot.stat.mode) {
      throw new Error('The source changed since review. Select it again and generate a fresh edit.');
    }
  };
  await assertUnchanged();
  const temp = join(dirname(snapshot.file), '.vertex-edit-' + randomUUID());
  const handle = await open(temp, 'wx', snapshot.stat.mode & 0o777);
  try {
    try {
      await handle.chmod(snapshot.stat.mode & 0o777);
      await handle.writeFile(edit.updated, 'utf8');
    } finally {
      await handle.close();
    }
    await assertUnchanged();
    await rename(temp, snapshot.file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

module.exports = { readSource, previewEdit, applyEdit };
