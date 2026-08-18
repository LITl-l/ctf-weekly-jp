import type { Env } from './types';
import { runAndPost } from './pipeline';
import { verifyRequest } from './discord/verify';
import { handleInteraction, type Interaction } from './discord/interactions';

/**
 * The impure shell. Everything below this file is a function of its inputs;
 * this is where the schedule, the network, and the request live. See ADR-0004.
 */
export default {
  /** Cron trigger: Monday 00:00 UTC = Monday 09:00 JST. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runAndPost(env).then((result) => {
        if (!result.ok) console.error('weekly digest could not be posted', result.error);
      }),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok');
    }

    if (request.method === 'POST' && url.pathname === '/interactions') {
      const { valid, body } = await verifyRequest(request, env.DISCORD_PUBLIC_KEY);
      if (!valid) return new Response('invalid request signature', { status: 401 });
      return handleInteraction(JSON.parse(body) as Interaction, env, ctx);
    }

    return new Response('not found', { status: 404 });
  },
};
