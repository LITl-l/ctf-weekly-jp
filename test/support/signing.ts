const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Real Ed25519, because that is what Discord signs interaction requests with. */
export async function makeKeypair() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const publicKey = toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const sign = async (message: string): Promise<string> =>
    toHex(
      await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)),
    );

  return { publicKey, sign };
}

export interface SignedRequestOptions {
  readonly body: string;
  readonly timestamp: string;
  readonly sign: (message: string) => Promise<string>;
  readonly url?: string;
}

export const signedRequest = async ({
  body,
  timestamp,
  sign,
  url = 'https://worker.example.com/interactions',
}: SignedRequestOptions): Promise<Request> =>
  new Request(url, {
    method: 'POST',
    body,
    headers: {
      'X-Signature-Ed25519': await sign(timestamp + body),
      'X-Signature-Timestamp': timestamp,
    },
  });
