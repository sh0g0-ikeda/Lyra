import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './lib/env.js';

if (env.SUPABASE_JWT_SECRET === undefined) {
  throw new Error('SUPABASE_JWT_SECRET is not set');
}

serve(
  {
    fetch: createApp().fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Lyra API listening on http://localhost:${info.port}`);
  },
);
