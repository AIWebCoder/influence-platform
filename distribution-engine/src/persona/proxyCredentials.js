const crypto = require('crypto');

function decryptProxyPassword(passwordEncrypted) {
  if (!passwordEncrypted) return null;
  if (!passwordEncrypted.startsWith('ENC:')) return passwordEncrypted;

  const keyRaw = process.env.PROXY_CREDENTIALS_KEY || '';
  if (!keyRaw) {
    throw new Error('PROXY_CREDENTIALS_KEY is required for encrypted proxy credentials');
  }
  const key = crypto.createHash('sha256').update(keyRaw).digest();
  const payload = passwordEncrypted.slice(4);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted proxy password format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { decryptProxyPassword };
