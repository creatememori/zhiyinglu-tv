export const runtime = 'edge';
import { handleProxy } from './lib/proxy-core.js';
export default async function handler(request) {
  const healthReq = new Request(new URL('/api/health', request.url), { method: 'GET' });
  return handleProxy(healthReq, { env: {} });
}