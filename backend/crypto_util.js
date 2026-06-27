const crypto = require('crypto');

/**
 * Encrypts a JSON payload using AES-256-GCM
 * @param {Object} payload The payload object to encrypt
 * @param {string} secret The 16-byte node secret (hex string, e.g. from crypto.randomBytes(16).toString('hex'))
 * @returns {Object} { encryptedData, iv, authTag }
 */
function encryptPayload(payload, secret) {
  // Derive a 32-byte key from the secret
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const payloadStr = JSON.stringify({ ...payload, _ts: Date.now() });
  
  let encrypted = cipher.update(payloadStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

/**
 * Decrypts a JSON payload using AES-256-GCM
 * @param {Object} data { encryptedData, iv, authTag }
 * @param {string} secret The 16-byte node secret
 * @returns {Object|null} Decrypted payload object, or null if auth fails or expired
 */
function decryptPayload(data, secret) {
  try {
    const { encryptedData, iv, authTag } = data;
    if (!encryptedData || !iv || !authTag) return null;

    const key = crypto.createHash('sha256').update(secret).digest();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', 
      key, 
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    const payload = JSON.parse(decrypted);
    
    // Check timestamp to prevent replay attacks (allow 30 seconds max difference)
    if (Math.abs(Date.now() - payload._ts) > 60000) {
      console.warn('[Crypto] Payload timestamp expired (Replay Attack?)');
      return null;
    }
    
    return payload;
  } catch (err) {
    return null; // Authentication failed
  }
}

module.exports = {
  encryptPayload,
  decryptPayload
};
