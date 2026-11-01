import { handleStream } from './lib/proxy-core.js';

/** Cloudflare Pages Function：/api/stream 流媒体中继（m3u8 分片同源转发） */
export async function onRequest(context) {
  return handleStream(context.request, context.env);
}