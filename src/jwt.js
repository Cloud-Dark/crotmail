/**
 * Simple JWT implementation for Cloudflare Workers
 */

function base64UrlEncode(str) {
  const base64 = btoa(str);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSha256(key, data) {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const messageData = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export class SignJWT {
  constructor(payload) {
    this.payload = payload;
    this.protectedHeader = {};
  }

  setProtectedHeader(header) {
    this.protectedHeader = { ...this.protectedHeader, ...header };
    return this;
  }

  setIssuedAt() {
    this.payload.iat = Math.floor(Date.now() / 1000);
    return this;
  }

  setExpirationTime(exp) {
    if (typeof exp === 'string' && exp.endsWith('m')) {
      this.payload.exp = Math.floor(Date.now() / 1000) + parseInt(exp) * 60;
    } else if (typeof exp === 'string' && exp.endsWith('h')) {
      this.payload.exp = Math.floor(Date.now() / 1000) + parseInt(exp) * 3600;
    } else {
      this.payload.exp = parseInt(exp);
    }
    return this;
  }

  async sign(key) {
    const encoder = new TextEncoder();
    const header = base64UrlEncode(JSON.stringify(this.protectedHeader));
    const payload = base64UrlEncode(JSON.stringify(this.payload));
    const data = `${header}.${payload}`;
    
    const signature = await hmacSha256(key, data);
    const signatureUrl = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    return `${data}.${signatureUrl}`;
  }
}

export async function jwtVerify(token, key) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  
  const expectedSignature = await hmacSha256(key, data);
  const expectedSignatureUrl = expectedSignature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  if (signature !== expectedSignatureUrl) {
    throw new Error('Invalid signature');
  }

  const decodedPayload = JSON.parse(base64UrlDecode(payload));
  
  if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return decodedPayload;
}
