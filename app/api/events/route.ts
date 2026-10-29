import { getAgentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

// GET /api/events - global SSE stream of engine-level events
// (session_started / session_ended / running_changed). One producer (the
// AgentEventBus), many consumers: this stream, the running-session sidebar
// stream, and future notification / audit / webhook subscribers.
export async function GET(req: Request) {
  // cleanup 需要被 start 与 cancel 两边共用：消费端 cancel（非 abort）时不实现
  // cancel() 的话，30s heartbeat 的 interval 会一直跑。
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        req.signal?.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed/cancelled */ }
      };
      req.signal?.addEventListener("abort", cleanup);
      const encode = (data: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      unsubscribe = getAgentEventBus().subscribe((event) => {
        encode({ type: "event", event });
      });

      // Heartbeat to keep the connection alive through proxies/timeouts.
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(":\n\n")); }
        catch { cleanup(); }
      }, 30_000);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}