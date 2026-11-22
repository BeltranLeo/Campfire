// Vercel Function entry point: every `/api/*` request is rewritten here (see vercel.json) and routed by path.

import { waitUntil } from '@vercel/functions';
import { ConfigError, createAppFromEnv } from '../src/server/index.js';

let handlerPromise: Promise<(req: Request) => Promise<Response>> | null = null;

function getHandler(): Promise<(req: Request) => Promise<Response>> {
  if (!handlerPromise) {
    handlerPromise = createAppFromEnv(process.env, { waitUntil }).then((app) => app.handler);
    // A failed start (for example a database that is still waking up) is retried on the next request.
    handlerPromise.catch(() => {
      handlerPromise = null;
    });
  }
  return handlerPromise;
}

export default {
  async fetch(request: Request): Promise<Response> {
    let handler: (req: Request) => Promise<Response>;
    try {
      handler = await getHandler();
    } catch (err) {
      // Configuration errors name missing variables, never their values.
      const message = err instanceof ConfigError ? err.message : 'Campfire failed to start';
      console.error(message, err instanceof ConfigError ? '' : err);
      return Response.json({ error: message }, { status: 503 });
    }
    return handler(request);
  },
};
