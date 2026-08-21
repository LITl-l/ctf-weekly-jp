/**
 * Discord signs every interaction request with Ed25519. Unverified requests must
 * be rejected with 401 — Discord actively probes this during endpoint setup and
 * will refuse to save an endpoint that accepts bad signatures.
 */

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd-length hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('invalid hex string');
    bytes[i] = byte;
  }
  return bytes;
}

/**
 * A signature alone never expires, so one captured request could be replayed
 * forever — re-applying a config change after an admin reset it, or forcing
 * unbounded digest runs. Discord's docs call for rejecting a stale timestamp;
 * five minutes each way is generous for clock skew and useless for a replay.
 */
const MAX_TIMESTAMP_AGE_SECONDS = 300;

const isFresh = (timestamp: string, now: Date): boolean => {
  const seconds = Number(timestamp);
  return (
    Number.isFinite(seconds) &&
    Math.abs(now.getTime() / 1000 - seconds) <= MAX_TIMESTAMP_AGE_SECONDS
  );
};

export async function verifySignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!signature || !timestamp || !publicKey) return false;
  if (!isFresh(timestamp, now)) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

/** Returns the raw body alongside the verdict; the body can only be read once. */
export async function verifyRequest(
  request: Request,
  publicKey: string,
  now: Date = new Date(),
): Promise<{ valid: boolean; body: string }> {
  const body = await request.text();
  const valid = await verifySignature(
    body,
    request.headers.get('X-Signature-Ed25519'),
    request.headers.get('X-Signature-Timestamp'),
    publicKey,
    now,
  );
  return { valid, body };
}
