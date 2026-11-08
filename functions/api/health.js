import { handleProxy } from '../../worker/proxy-core.js';

/** Pages Function: GET /api/health confirms this exact deployment is serving the proxy. */
export async function onRequest(context) {
  const request = new Request(new URL('/api/health', context.request.url), { method: 'GET' });
  return handleProxy(request, context.env);
}
