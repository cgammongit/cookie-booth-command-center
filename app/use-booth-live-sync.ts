"use client";

import { useEffect, useRef } from "react";
import type { BoothLiveEvent } from "../lib/booth-live";

const MAX_RECONNECT_DELAY_MS = 15_000;

export function useBoothLiveSync({
  boothIds,
  onRefresh,
  onConnectionChange,
}: {
  boothIds: number[];
  onRefresh: (missedRevision: boolean) => Promise<void>;
  onConnectionChange?: (connected: boolean) => void;
}) {
  const refreshRef = useRef(onRefresh);
  const connectionChangeRef = useRef(onConnectionChange);
  const normalizedIds = [...new Set(boothIds)].sort((a, b) => a - b);
  const roomKey = normalizedIds.join(",");

  useEffect(() => {
    refreshRef.current = onRefresh;
    connectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange, onRefresh]);

  useEffect(() => {
    if (!normalizedIds.length) {
      connectionChangeRef.current?.(false);
      return;
    }

    let active = true;
    let retryAttempt = 0;
    let retryTimer: number | undefined;
    const sockets = new Map<number, WebSocket>();
    const revisions = new Map<number, number>();
    const requestedRevisions = new Map<number, number>();
    const pendingRevisions = new Map<number, { revision: number; missed: boolean }>();
    let refreshRunning = false;

    const updateConnectionState = () => {
      connectionChangeRef.current?.(
        active &&
        document.visibilityState === "visible" &&
        normalizedIds.every((boothId) => sockets.get(boothId)?.readyState === WebSocket.OPEN),
      );
    };

    const drainRefreshes = async () => {
      if (refreshRunning || !active) return;
      refreshRunning = true;
      try {
        while (active && pendingRevisions.size) {
          const pending = [...pendingRevisions.entries()];
          pendingRevisions.clear();
          await refreshRef.current(pending.some(([, event]) => event.missed));
          for (const [boothId, event] of pending) {
            revisions.set(boothId, Math.max(revisions.get(boothId) || 0, event.revision));
          }
        }
      } finally {
        refreshRunning = false;
      }
    };

    const queueRefresh = (
      boothId: number,
      revision: number,
      missed: boolean,
      force = false,
    ) => {
      if (!force && revision <= (requestedRevisions.get(boothId) || 0)) return;
      requestedRevisions.set(
        boothId,
        Math.max(requestedRevisions.get(boothId) || 0, revision),
      );
      const existing = pendingRevisions.get(boothId);
      pendingRevisions.set(boothId, {
        revision: Math.max(existing?.revision || 0, revision),
        missed: Boolean(existing?.missed || missed),
      });
      void drainRefreshes();
    };

    const closeSockets = () => {
      for (const socket of sockets.values()) socket.close(1000, "Page inactive");
      sockets.clear();
      updateConnectionState();
    };

    const connect = () => {
      window.clearTimeout(retryTimer);
      if (!active || document.visibilityState !== "visible") return;
      closeSockets();

      for (const boothId of normalizedIds) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${protocol}//${window.location.host}/api/booths/${boothId}/live`,
        );
        sockets.set(boothId, socket);
        socket.addEventListener("open", () => {
          retryAttempt = 0;
          updateConnectionState();
        });
        socket.addEventListener("message", (message) => {
          if (typeof message.data !== "string" || message.data === "pong") return;
          let event: BoothLiveEvent;
          try {
            event = JSON.parse(message.data) as BoothLiveEvent;
          } catch {
            return;
          }
          if (event.boothId !== boothId) return;
          const currentRevision = revisions.get(boothId) || 0;
          if (event.type === "ready") {
            queueRefresh(boothId, event.revision, currentRevision !== event.revision, true);
            return;
          }
          if (event.revision <= currentRevision) return;
          queueRefresh(boothId, event.revision, event.revision !== currentRevision + 1);
        });
        const reconnect = () => {
          if (sockets.get(boothId) !== socket) return;
          sockets.delete(boothId);
          updateConnectionState();
          if (!active || document.visibilityState !== "visible") return;
          window.clearTimeout(retryTimer);
          const delay = Math.min(1_000 * 2 ** retryAttempt, MAX_RECONNECT_DELAY_MS);
          retryAttempt += 1;
          retryTimer = window.setTimeout(connect, delay);
        };
        socket.addEventListener("close", reconnect, { once: true });
        socket.addEventListener("error", () => socket.close(), { once: true });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        queueMicrotask(connect);
      } else {
        window.clearTimeout(retryTimer);
        closeSockets();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeSockets();
    };
    // roomKey is the stable representation of the normalized room list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey]);
}
