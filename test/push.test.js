// Prüfung der Push-Verschlüsselung gegen den Testvektor aus RFC 8291 (Anhang A): `npm test`
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createHmac, createPublicKey, verify } from 'node:crypto';
import { encryptPayload, makeVapid, vapidHeader } from '../server/push.js';
const u = s => Buffer.from(s, 'base64url');
// RFC 8291, Abschnitt 5 und Anhang A
const sub = { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHada3d3ZJPCQsd_Q' };
const asPriv = u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
const salt = u('DGv6ra1nlYgDCS1FRnbzlw');
const text = 'When I grow up, I want to be a watermelon';
const out = encryptPayload(sub, text, { asPriv, salt });
// Aufbau: salt(16) | rs(4) | idlen(1) | as_public(65) | Chiffre. Der Kopf entspricht dem RFC-Beispiel.
assert.equal(out.subarray(0, 21 + 65).toString('base64url').startsWith('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A'), true);
// Empfängerseite unabhängig nachgerechnet (Browser): mit dem privaten Schlüssel des Empfängers entschlüsseln
function decrypt(body, uaPrivB64, uaPubB64, authB64) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ua = createECDH('prime256v1'); ua.setPrivateKey(u(uaPrivB64));
  const shared = ua.computeSecret(asPub);
  const hm = (k, d) => createHmac('sha256', k).update(d).digest();
  const expand = (prk, info, n) => hm(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, n);
  const ikm = expand(hm(u(authB64), shared), Buffer.concat([Buffer.from('WebPush: info\0'), u(uaPubB64), asPub]), 32);
  const prk = hm(salt, ikm);
  const d = createDecipheriv('aes-128-gcm', expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16), expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, plain.length - 1).toString();
}
assert.equal(decrypt(out, 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', sub.p256dh, sub.auth), text);
// Zufälliger Empfänger
const r = createECDH('prime256v1'); r.generateKeys(); const rsub = { p256dh: r.getPublicKey().toString('base64url'), auth: Buffer.from('0123456789abcdef').toString('base64url') };
assert.equal(decrypt(encryptPayload(rsub, 'Ümläute ✓'), r.getPrivateKey().toString('base64url'), rsub.p256dh, rsub.auth), 'Ümläute ✓');
// VAPID: Signatur lässt sich mit dem öffentlichen Schlüssel prüfen
const v = makeVapid(); const h = vapidHeader(v, 'https://push.example.org/abc', 'mailto:a@b.de');
const jwt = /t=([^,]+),/.exec(h)[1].split('.');
const x = u(v.pub).subarray(1, 33), y = u(v.pub).subarray(33);
const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') }, format: 'jwk' });
assert.ok(verify('sha256', Buffer.from(jwt[0] + '.' + jwt[1]), { key: pub, dsaEncoding: 'ieee-p1363' }, u(jwt[2])));
assert.equal(JSON.parse(u(jwt[1])).aud, 'https://push.example.org');
console.log('Alle Push-Tests bestanden.');
