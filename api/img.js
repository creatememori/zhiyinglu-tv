export const runtime = 'edge';
import { handleImg } from './lib/proxy-core.js';
export default async function handler(request) { return handleImg(request, { env: {} }); }