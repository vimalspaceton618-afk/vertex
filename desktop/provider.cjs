const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const defaultBase = 'https://api.deepseek.com';
function baseURL(value = defaultBase) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTPS provider URL or a local HTTP server.');
  }
  return url.href.replace(/\/+$/, '');
}

function profileStore(file, encryption) {
  async function read() {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { base: defaultBase, model: 'deepseek-flash' };
    }
  }
  function publicFields({ base, model, cipher }) {
    return { base, model, saved: Boolean(cipher) };
  }
  return {
    async load() { return publicFields(await read()); },
    async save({ base, model, key, forget }) {
      base = baseURL(base);
      if (!/^[\w./:-]{1,200}$/.test(model)) throw new Error('Enter a model ID.');
      const old = await read();
      const profile = { base, model };
      if (key) {
        if (!/^[!-~]{1,512}$/.test(key)) throw new Error('Enter a valid API key.');
        if (!await encryption.isAsyncEncryptionAvailable()) throw new Error('Secure key storage is unavailable.');
        profile.cipher = (await encryption.encryptStringAsync(key)).toString('base64');
      } else if (!forget && old.base === base) profile.cipher = old.cipher;
      const tmp = file + '.' + randomUUID();
      try {
        await fs.writeFile(tmp, JSON.stringify(profile), { flag: 'wx', mode: 0o600 });
        await fs.rename(tmp, file);
      } finally { await fs.rm(tmp, { force: true }); }
      return publicFields(profile);
    },
    async credentials(base) {
      const profile = await read();
      if (profile.base !== baseURL(base) || !profile.cipher) return '';
      return (await encryption.decryptStringAsync(Buffer.from(profile.cipher, 'base64'))).result;
    }
  };
}
module.exports = { defaultBase, baseURL, profileStore };
