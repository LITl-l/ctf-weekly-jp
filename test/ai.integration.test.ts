import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { describeAiFailure, summarizeEvent } from '../src/ai';
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
/** Set by a test to force an error status and body on every request. */
let forced: { status: number; body: string } | null = null;

/**
 * Verbatim error bodies captured from Gemini's OpenAI-compatible endpoint. The
 * 404 is what a retired model answers, the 400 what a rejected key answers.
 * Hand-written stand-ins would not have caught that the useful part of the 404
 * is the sentence, not the status: both of these used to reach the operator as
 * nothing but `summaries: {"rule":N}`.
 */
const RETIRED_MODEL_404 =
  '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.","status":"NOT_FOUND"}}';
const MISSING_AUTH_400 =
  '{"error":{"code":400,"message":"Missing or invalid Authorization header.","status":"INVALID_ARGUMENT"}}';

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

      // Checked before `rejectJsonMode` so a forced error applies to the retry
      // too, which is what a real 404 or a real auth failure does.
      if (forced) {
        res.writeHead(forced.status, { 'Content-Type': 'application/json' });
        res.end(forced.body);
        return;
      }

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

/** Explicit, so test order can never decide what the server does. */
beforeEach(() => {
  received = [];
  rejectJsonMode = false;
  forced = null;
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

/**
 * A failed AI call must stay invisible to readers of the digest and visible to
 * whoever runs the dry run. These assert both halves: the event keeps its
 * rule-based verdict, and the status plus the provider's own words survive.
 */
describe('AI failures carry their cause', () => {
  it('reports status and a body snippet when the model has been retired', async () => {
    forced = { status: 404, body: RETIRED_MODEL_404 };

    const summary = await summarizeEvent(event, {
      baseUrl,
      model: 'gemini-2.5-flash',
      apiKey: 'sk-test-123',
    });

    // The event is never dropped, and the verdict is unchanged.
    expect(summary.source).toBe('rule');
    expect(summary.difficulty).toBe('unknown');
    expect(summary.reasonJa).toBeTruthy();

    const failure = summary.aiFailure;
    expect(failure?.kind).toBe('http');
    if (failure?.kind !== 'http') throw new Error('expected an http failure');
    expect(failure.status).toBe(404);
    // The actionable part of the sentence, not just the status code.
    expect(failure.body).toContain('gemini-2.5-flash is no longer available');
    expect(describeAiFailure(failure)).toContain('HTTP 404');

    // 224 characters capped to 200, so a huge HTML error page cannot flood stdout.
    expect(RETIRED_MODEL_404.length).toBeGreaterThan(200);
    expect(failure.body).toHaveLength(200);
    expect(failure.body.endsWith('…')).toBe(true);
  });

  it('reports a rejected key, and still makes exactly one retry', async () => {
    forced = { status: 400, body: MISSING_AUTH_400 };

    const summary = await summarizeEvent(event, {
      baseUrl,
      model: 'gemini-3.5-flash-lite',
      apiKey: 'sk-wrong',
    });

    // ADR-0002's single response_format retry, unchanged by any of this.
    expect(received).toHaveLength(2);
    expect(summary.source).toBe('rule');

    const failure = summary.aiFailure;
    if (failure?.kind !== 'http') throw new Error('expected an http failure');
    expect(failure.status).toBe(400);
    // 103 characters, under the cap, so it is kept exactly as the provider sent it.
    expect(failure.body).toBe(MISSING_AUTH_400);
    expect(describeAiFailure(failure)).toBe(`HTTP 400: ${MISSING_AUTH_400}`);
  });

  it('carries no failure when the model answers', async () => {
    const summary = await summarizeEvent(event, { baseUrl, model: 'm', apiKey: 'k' });

    expect(summary.source).toBe('ai');
    expect(summary.aiFailure).toBeUndefined();
  });

  it('carries no failure when no API key is configured, because that is a mode', async () => {
    const summary = await summarizeEvent(event, { baseUrl, model: 'm', apiKey: '' });

    expect(received).toHaveLength(0);
    expect(summary.source).toBe('rule');
    expect(summary.aiFailure).toBeUndefined();
  });
});
