import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { summarizeEvent } from '../src/ai';
import { makeEvent } from './support/event';

/**
 * Exercises the AI adapter against a real OpenAI-compatible HTTP server over a
 * real socket. Mocked `fetch` cannot catch malformed URL joins, header casing,
 * or body encoding problems — this can.
 */

interface Received {
  url: string;
  method: string;
  authorization?: string;
  contentType?: string;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
/** Set by a test to make the server reject `response_format` like some NIM models do. */
let rejectJsonMode = false;

const COMPLETION = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          summary_ja: 'リバースエンジニアリング専門のCTFです。初心者向けの問題も用意されています。',
          categories: ['rev'],
          difficulty: 'beginner',
          reason_ja: '公式説明に first-timers 向けと明記されています。',
        }),
      },
    },
  ],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      received.push({
        url: req.url ?? '',
        method: req.method ?? '',
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body,
      });

      if (rejectJsonMode && body.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'response_format is not supported by this model' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(COMPLETION));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const event = makeEvent({
  title: 'E0F CTF',
  description:
    '<b>E0F CTF</b> is a jeopardy-style CTF built around reverse engineering &amp; crackmes, from first-timers to seasoned reversers.',
  weight: 0,
  participants: 9,
  duration: { days: 1, hours: 0 },
  organizers: [{ id: 1, name: 'E0F' }],
});

describe('AI adapter over a real HTTP server', () => {
  it('speaks the OpenAI chat-completions protocol correctly', async () => {
    received = [];
    rejectJsonMode = false;

    const summary = await summarizeEvent(event, {
      baseUrl,
      model: 'local-test-model',
      apiKey: 'sk-test-123',
    });

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/chat/completions');
    expect(request.authorization).toBe('Bearer sk-test-123');
    expect(request.contentType).toContain('application/json');
    expect(request.body.model).toBe('local-test-model');
    expect(request.body.response_format).toEqual({ type: 'json_object' });

    const messages = request.body.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]!.content).toContain('E0F CTF');
    expect(messages[1]!.content).toContain('crackmes'); // HTML entity decoded, tags gone
    expect(messages[1]!.content).not.toContain('<b>');
    expect(messages[1]!.content).toContain('(未評価)'); // weight 0 flagged to the model

    expect(summary.source).toBe('ai');
    expect(summary.difficulty).toBe('beginner');
    expect(summary.categories).toEqual(['rev']);
    expect(summary.summaryJa).toContain('リバースエンジニアリング');
  });

  it('recovers when the server rejects response_format with 400', async () => {
    received = [];
    rejectJsonMode = true;

    const summary = await summarizeEvent(event, {
      baseUrl,
      model: 'local-test-model',
      apiKey: 'sk-test-123',
    });

    expect(received).toHaveLength(2);
    expect(received[0]!.body.response_format).toBeDefined();
    expect(received[1]!.body.response_format).toBeUndefined();
    expect(summary.source).toBe('ai');
  });

  it('tolerates a trailing slash in the base URL', async () => {
    received = [];
    rejectJsonMode = false;

    await summarizeEvent(event, { baseUrl: `${baseUrl}/`, model: 'm', apiKey: 'k' });
    expect(received[0]!.url).toBe('/v1/chat/completions');
  });
});
