import { handleImg } from './lib/proxy-core.js';

/** Cloudflare Pages Function：与前端同域提供 /api/img 图片反代（封面聚合通道）。 */
export async function onRequest(context) {
  return handleImg(context.request, context.env);
}