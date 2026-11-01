import { handleProxy } from './lib/proxy-core.js';

/** Cloudflare Pages Function：与前端同域提供 /api/proxy。 */
export async function onRequest(context) {
  return handleProxy(context.request, context.env);
}
