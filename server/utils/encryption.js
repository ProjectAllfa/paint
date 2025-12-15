const crypto = require('crypto');

// Encryption key - in production, this MUST be set in environment variables
// Generate a key: crypto.randomBytes(32).toString('hex')
// WARNING: If ENCRYPTION_KEY is not set, using a default key (NOT SECURE FOR PRODUCTION)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32chars!!';
if (!process.env.ENCRYPTION_KEY) {
    console.warn('[Encryption] WARNING: Using default encryption key. Set ENCRYPTION_KEY in environment variables for production!');
}

// Ensure key is 32 bytes (64 hex characters)
let key = ENCRYPTION_KEY;
if (key.length < 64) {
    // Pad or hash to get 32 bytes
    key = crypto.createHash('sha256').update(key).digest('hex');
}
const ALGORITHM = 'aes-256-cbc';

// Helper function to encrypt text
function encrypt(text) {
    if (!text || text.trim() === '') return '';
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('[Encryption] Error encrypting:', error);
        return '';
    }
}

// Helper function to decrypt text
function decrypt(encryptedText) {
    if (!encryptedText || encryptedText.trim() === '') return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 2) return '';
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('[Encryption] Error decrypting:', error);
        return '';
    }
}

module.exports = {
    encrypt,
    decrypt
};

