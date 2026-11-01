export const runtime = 'edge';
import { handleProxy } from './lib/proxy-core.js';
export default async function handler(request) { return handleProxy(request, { env: {} }); }