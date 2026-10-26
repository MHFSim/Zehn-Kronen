// Zehn Kronen – Web-Push ohne Zusatzpakete (VAPID, RFC 8291 "aes128gcm").
// Funktioniert nur über HTTPS (oder localhost). Auf dem iPhone muss die Seite zum Home-Bildschirm hinzugefügt sein.
import { createECDH, createPrivateKey, createPublicKey, createCipheriv, createHmac, randomBytes, sign, generateKeyPairSync } from 'node:crypto';
import { request } from 'node:https';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// HKDF mit SHA-256, Länge höchstens 32 Byte
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

/* ---------- Schlüssel ---------- */
// Erzeugt ein VAPID-Schlüsselpaar: privat als PKCS8-Base64url, öffentlich als unkomprimierter Punkt (65 Byte)
export function makeVapid() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)]);
  return { priv: b64u(privateKey.export({ format: 'der', type: 'pkcs8' })), pub: b64u(point) };
}

/* ---------- VAPID-Kopf ---------- */
export function vapidHeader(vapid, endpoint, subject, exp = Math.floor(Date.now() / 1000) + 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), body = b64u(JSON.stringify({ aud, exp, sub: subject }));
  const key = createPrivateKey({ key: unb64u(vapid.priv), format: 'der', type: 'pkcs8' });
  const sig = sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vapid.pub;
}

/* ---------- Verschlüsselung der Nachricht (RFC 8291) ---------- */
// sub = { p256dh, auth } als Base64url vom Browser. Optional feste Werte für Tests.
export function encryptPayload(sub, payload, fixed = {}) {
  const uaPub = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const ecdh = createECDH('prime256v1');
  if (fixed.asPriv) ecdh.setPrivateKey(fixed.asPriv); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPub);
  const salt = fixed.salt || randomBytes(16);
  const prk = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const data = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}

/* ---------- Senden ---------- */
// Gibt den HTTP-Status zurück (201 = angenommen, 404/410 = Abo ist ungültig und sollte gelöscht werden)
export function sendPush(vapid, subject, sub, message, { ttl = 3600 } = {}) {
  return new Promise(resolve => {
    let body; try { body = encryptPayload(sub, JSON.stringify(message)); } catch { return resolve(0); }
    let u; try { u = new URL(sub.endpoint); } catch { return resolve(0); }
    if (u.protocol !== 'https:') return resolve(0);
    const req = request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10000, headers: {
      Authorization: vapidHeader(vapid, sub.endpoint, subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      'Content-Length': body.length, TTL: String(ttl), Urgency: 'high' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
    req.end(body);
  });
}
export { createPublicKey };
