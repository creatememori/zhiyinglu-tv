export const runtime = 'edge';
export default function handler() {
  return new Response(JSON.stringify({ ok: true, runtime: 'edge' }), {
    headers: { 'content-type': 'application/json' }
  });
}