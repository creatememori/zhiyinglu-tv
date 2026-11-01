export const runtime = 'edge';
import { handleStream } from './lib/proxy-core.js';
export default async function handler(request) { return handleStream(request, { env: {} }); }