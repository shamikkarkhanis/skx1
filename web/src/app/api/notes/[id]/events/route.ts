import { unstable_noStore as noStore } from 'next/cache';
import { NextResponse } from 'next/server';
import { getNoteEmitter } from '@/lib/noteEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// SSE endpoint: /api/notes/[id]/events
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  noStore();
  const { id } = await context.params;
  if (!id) return new NextResponse('Missing id', { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) => {
        const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // Initial: keep-alive and identify
      send('keepalive', { ok: true, id });

      const em = getNoteEmitter(id);
      const onProcessed = (data: any) => send('processed', data);
      const onError = (err: any) => send('error', { message: String(err?.message || err) });
      em.on('processed', onProcessed);
      em.on('error', onError);

      const interval = setInterval(() => send('keepalive', { ok: true }), 15000);

      // Abort/cleanup
      const signal = (req as any).signal as AbortSignal | undefined;
      const cleanup = () => {
        clearInterval(interval);
        em.off('processed', onProcessed);
        em.off('error', onError);
        controller.close();
      };
      if (signal) {
        signal.addEventListener('abort', cleanup, { once: true });
      }
    },
  });

  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
