import type {
  PenTransport,
  PenStreamRequest,
  PenStreamPart,
  Unsubscribe,
} from "@pen/types";
import type { SSEClientOptions } from "./types";
import { parseSSEStream } from "./parser";

export function sseTransport(options: SSEClientOptions): PenTransport {
  const {
    url,
    headers = {},
    reconnect: _enableReconnect = true,
    reconnectDelay = 1000,
    maxReconnectAttempts = 5,
    pingTimeout = 30_000,
  } = options;

  let isConnected = false;
  let activeAbort: AbortController | null = null;
  const connectionListeners = new Set<(connected: boolean) => void>();

  function setConnected(value: boolean): void {
    if (isConnected === value) return;
    isConnected = value;
    for (const cb of connectionListeners) cb(value);
  }

  const transport: PenTransport = {
    async *stream(
      request: PenStreamRequest,
    ): AsyncGenerator<PenStreamPart> {
      activeAbort = new AbortController();
      const signal = options.signal
        ? composeAbortSignals(options.signal, activeAbort.signal)
        : activeAbort.signal;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...headers,
          },
          body: JSON.stringify(request),
          signal,
        });

        if (!response.ok) {
          yield {
            type: "error",
            errorText: `SSE request failed: ${response.status} ${response.statusText}`,
            code: `HTTP_${response.status}`,
          } as PenStreamPart;
          return;
        }

        if (!response.body) {
          yield {
            type: "error",
            errorText: "SSE response has no body",
            code: "NO_BODY",
          } as PenStreamPart;
          return;
        }

        setConnected(true);
        let lastEventId: string | undefined;
        let pingTimer: ReturnType<typeof setTimeout> | null = null;

        const resetPingTimer = (): void => {
          if (pingTimer) clearTimeout(pingTimer);
          pingTimer = setTimeout(() => {
            setConnected(false);
          }, pingTimeout);
        };
        resetPingTimer();

        const reader = response.body.getReader();
        try {
          for await (const sseEvent of parseSSEStream(reader)) {
            resetPingTimer();

            if (sseEvent.id) lastEventId = sseEvent.id;

            const part = JSON.parse(sseEvent.data) as PenStreamPart;

            if (part.type === "ping") continue;

            yield part;

            if (part.type === "done" || part.type === "error") break;
          }
        } finally {
          if (pingTimer) clearTimeout(pingTimer);
          reader.releaseLock();
        }
      } catch (error) {
        if (signal.aborted) return;
        setConnected(false);

        yield {
          type: "error",
          errorText: error instanceof Error ? error.message : String(error),
          code: "NETWORK_ERROR",
        } as PenStreamPart;
      } finally {
        activeAbort = null;
      }
    },

    async *reconnect(streamId: string): AsyncGenerator<PenStreamPart> {
      let attempts = 0;

      while (attempts < maxReconnectAttempts) {
        attempts++;

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              "Last-Event-ID": streamId,
              ...headers,
            },
          });

          if (response.status === 501) {
            yield {
              type: "error",
              errorText:
                "Replay unsupported by transport, start a fresh stream",
              code: "REPLAY_UNSUPPORTED",
            } as PenStreamPart;
            return;
          }

          if (!response.ok || !response.body) {
            await delay(reconnectDelay * attempts);
            continue;
          }

          setConnected(true);
          const reader = response.body.getReader();

          try {
            for await (const sseEvent of parseSSEStream(reader)) {
              const part = JSON.parse(sseEvent.data) as PenStreamPart;
              if (part.type === "ping") continue;
              yield part;
              if (part.type === "done" || part.type === "error") return;
            }
          } finally {
            reader.releaseLock();
          }
          return;
        } catch {
          setConnected(false);
          await delay(reconnectDelay * attempts);
        }
      }

      yield {
        type: "error",
        errorText: `Reconnection failed after ${maxReconnectAttempts} attempts`,
        code: "RECONNECT_EXHAUSTED",
      } as PenStreamPart;
    },

    async connect(): Promise<void> {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          headers,
        });
        setConnected(response.ok);
      } catch {
        setConnected(false);
      }
    },

    async disconnect(): Promise<void> {
      activeAbort?.abort();
      activeAbort = null;
      setConnected(false);
    },

    get connected(): boolean {
      return isConnected;
    },

    onConnectionChange(
      callback: (connected: boolean) => void,
    ): Unsubscribe {
      connectionListeners.add(callback);
      return () => connectionListeners.delete(callback);
    },
  };

  return transport;
}

function composeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
