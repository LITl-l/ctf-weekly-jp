import { describe, expect, it } from 'vitest';
import { verifyRequest, verifySignature } from '../src/discord/verify';

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function makeKeypair() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const sign = async (message: string) =>
    toHex(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)));
  return { publicKey, sign };
}

describe('verifySignature', () => {
  it('accepts a signature over timestamp + body', async () => {
    const { publicKey, sign } = await makeKeypair();
    const timestamp = '1755500000';
    const body = '{"type":1}';
    await expect(verifySignature(body, await sign(timestamp + body), timestamp, publicKey)).resolves.toBe(true);
  });

  it('rejects a tampered body', async () => {
    const { publicKey, sign } = await makeKeypair();
    const timestamp = '1755500000';
    const signature = await sign(timestamp + '{"type":1}');
    await expect(verifySignature('{"type":2}', signature, timestamp, publicKey)).resolves.toBe(false);
  });

  it('rejects a replayed signature under a different timestamp', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const signature = await sign('1755500000' + body);
    await expect(verifySignature(body, signature, '1755500001', publicKey)).resolves.toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const a = await makeKeypair();
    const b = await makeKeypair();
    const timestamp = '1755500000';
    const body = '{"type":1}';
    await expect(verifySignature(body, await a.sign(timestamp + body), timestamp, b.publicKey)).resolves.toBe(false);
  });

  it('rejects missing headers and malformed hex without throwing', async () => {
    const { publicKey } = await makeKeypair();
    await expect(verifySignature('{}', null, '1', publicKey)).resolves.toBe(false);
    await expect(verifySignature('{}', 'zz', '1', publicKey)).resolves.toBe(false);
    await expect(verifySignature('{}', 'abc', '1', publicKey)).resolves.toBe(false);
    await expect(verifySignature('{}', 'aabb', '1', '')).resolves.toBe(false);
  });
});

describe('verifyRequest', () => {
  it('returns the body alongside the verdict', async () => {
    const { publicKey, sign } = await makeKeypair();
    const timestamp = '1755500000';
    const body = '{"type":1}';
    const request = new Request('https://example.com/interactions', {
      method: 'POST',
      body,
      headers: {
        'X-Signature-Ed25519': await sign(timestamp + body),
        'X-Signature-Timestamp': timestamp,
      },
    });
    await expect(verifyRequest(request, publicKey)).resolves.toEqual({ valid: true, body });
  });
});
