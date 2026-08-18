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

export async function verifySignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
  publicKey: string,
): Promise<boolean> {
  if (!signature || !timestamp || !publicKey) return false;
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
): Promise<{ valid: boolean; body: string }> {
  const body = await request.text();
  const valid = await verifySignature(
    body,
    request.headers.get('X-Signature-Ed25519'),
    request.headers.get('X-Signature-Timestamp'),
    publicKey,
  );
  return { valid, body };
}
