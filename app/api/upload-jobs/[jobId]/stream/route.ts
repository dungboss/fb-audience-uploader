import { getAudienceUploadJob } from "@/lib/audience-upload/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint that pushes job status updates every ~1.5s from Redis.
 *
 * - Any browser (same device, different device, reopened tab) connecting will
 *   see the same real-time job progress.
 * - EventSource handles automatic reconnection when the browser tab is closed
 *   and reopened, or when the network drops.
 * - Stream auto-closes when the job reaches a terminal state.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setInterval> | null = null;

      const enqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${s}\n\n`));
        } catch {
          closeStream();
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // stream may already be closed
        }
      };

      // Keep-alive comment every 15s so proxies don't drop idle connections
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          closeStream();
        }
      }, 15000);

      try {
        // Send initial snapshot immediately
        const first = await getAudienceUploadJob(jobId);
        enqueue(JSON.stringify(first));

        // If already terminal, close immediately
        if (first.status === "completed" || first.status === "failed") {
          closeStream();
          clearInterval(keepAlive);
          return;
        }

        // Poll Redis every 1.5s
        timer = setInterval(async () => {
          if (closed) return;

          try {
            const job = await getAudienceUploadJob(jobId);
            enqueue(JSON.stringify(job));

            if (job.status === "completed" || job.status === "failed") {
              closeStream();
              clearInterval(keepAlive);
            }
          } catch {
            // skip failed tick — EventSource will reconnect if needed
          }
        }, 1500);
      } catch {
        enqueue(JSON.stringify({ error: "Không tìm thấy upload job." }));
        closeStream();
        clearInterval(keepAlive);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}