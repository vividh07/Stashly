import { createApp, bootstrapAdmin } from './app';
import type { Bindings } from './env';

const app = createApp();

let bootstrapped = false;

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (!bootstrapped) {
      ctx.waitUntil(
        bootstrapAdmin(env)
          .then(() => {
            bootstrapped = true;
          })
          .catch(() => {
            /* ignore bootstrap race */
          }),
      );
    }
    return app.fetch(request, env, ctx);
  },
};
