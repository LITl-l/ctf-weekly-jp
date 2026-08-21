import { describe, expect, it } from 'vitest';
import { verifyRequest, verifySignature } from '../src/discord/verify';
import { makeKeypair, signedRequest } from './support/signing';

const NOW = new Date('2026-08-21T00:00:00Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const at = (secondsFromNow: number) => new Date(NOW.getTime() + secondsFromNow * 1000);

describe('verifySignature', () => {
  it('accepts a signature over timestamp + body', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    await expect(
      verifySignature(body, await sign(TIMESTAMP + body), TIMESTAMP, publicKey, NOW),
    ).resolves.toBe(true);
  });

  it('rejects a tampered body', async () => {
    const { publicKey, sign } = await makeKeypair();
    const signature = await sign(TIMESTAMP + '{"type":1}');
    await expect(
      verifySignature('{"type":2}', signature, TIMESTAMP, publicKey, NOW),
    ).resolves.toBe(false);
  });

  it('rejects a replayed signature under a different timestamp', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const signature = await sign(TIMESTAMP + body);
    await expect(
      verifySignature(body, signature, String(Number(TIMESTAMP) + 1), publicKey, NOW),
    ).resolves.toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const a = await makeKeypair();
    const b = await makeKeypair();
    const body = '{"type":1}';
    await expect(
      verifySignature(body, await a.sign(TIMESTAMP + body), TIMESTAMP, b.publicKey, NOW),
    ).resolves.toBe(false);
  });

  it('rejects missing headers and malformed hex without throwing', async () => {
    const { publicKey } = await makeKeypair();
    await expect(verifySignature('{}', null, TIMESTAMP, publicKey, NOW)).resolves.toBe(false);
    await expect(verifySignature('{}', 'zz', TIMESTAMP, publicKey, NOW)).resolves.toBe(false);
    await expect(verifySignature('{}', 'abc', TIMESTAMP, publicKey, NOW)).resolves.toBe(false);
    await expect(verifySignature('{}', 'aabb', TIMESTAMP, '', NOW)).resolves.toBe(false);
  });

  it('rejects a captured request replayed after the window closes', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const signature = await sign(TIMESTAMP + body);

    await expect(
      verifySignature(body, signature, TIMESTAMP, publicKey, at(299)),
    ).resolves.toBe(true);
    await expect(
      verifySignature(body, signature, TIMESTAMP, publicKey, at(3600)),
    ).resolves.toBe(false);
  });

  it('rejects a timestamp far enough in the future to be forged, not skewed', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const signature = await sign(TIMESTAMP + body);

    await expect(
      verifySignature(body, signature, TIMESTAMP, publicKey, at(-299)),
    ).resolves.toBe(true);
    await expect(
      verifySignature(body, signature, TIMESTAMP, publicKey, at(-3600)),
    ).resolves.toBe(false);
  });

  it('rejects a timestamp that is not a number at all', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    await expect(
      verifySignature(body, await sign('later' + body), 'later', publicKey, NOW),
    ).resolves.toBe(false);
  });
});

describe('verifyRequest', () => {
  it('returns the body alongside the verdict', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const request = await signedRequest({ body, timestamp: TIMESTAMP, sign });

    await expect(verifyRequest(request, publicKey, NOW)).resolves.toEqual({ valid: true, body });
  });

  it('reports a stale request as invalid while still returning its body', async () => {
    const { publicKey, sign } = await makeKeypair();
    const body = '{"type":1}';
    const request = await signedRequest({ body, timestamp: TIMESTAMP, sign });

    await expect(verifyRequest(request, publicKey, at(7200))).resolves.toEqual({
      valid: false,
      body,
    });
  });
});
