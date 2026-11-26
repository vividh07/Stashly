/** Proxy /api/* to the Worker so cookies stay same-origin on Pages. */
const WORKER_ORIGIN = 'https://personal-vault-api.cheemtu.workers.dev';

interface PagesEnv {
  VAULT_API?: { fetch: (request: Request) => Promise<Response> };
}

interface PagesContext {
  request: Request;
  env: PagesEnv;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.env.VAULT_API) {
    return context.env.VAULT_API.fetch(context.request);
  }

  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, WORKER_ORIGIN);
  const headers = new Headers(context.request.headers);
  headers.set('Host', target.host);
  headers.set('X-Forwarded-Host', incoming.host);
  headers.set('X-Forwarded-Proto', incoming.protocol.replace(':', ''));

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: 'manual',
  };
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body;
    // Required when forwarding a stream body in some runtimes.
    (init as RequestInit & { duplex?: 'half' }).duplex = 'half';
  }

  return fetch(new Request(target.toString(), init));
}
