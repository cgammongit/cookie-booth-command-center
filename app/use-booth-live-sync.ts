"use client";

import { useEffect, useRef } from "react";
import type { BoothLiveEvent } from "../lib/booth-live";

const HEARTBEAT_INTERVAL_MS = 27_500;
const PONG_DEADLINE_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 60_000;
const FAST_RECONNECT_ATTEMPTS = 5;

export type LiveSyncStatus =
  | "connected"
  | "reconnecting"
  | "polling"
  | "paused";

export function useBoothLiveSync({
  boothIds,
  onRefresh,
  onStatusChange,
}: {
  boothIds: number[];
  onRefresh: (missedRevision: boolean) => Promise<void>;
  onStatusChange?: (status: LiveSyncStatus) => void;
}) {
  const refreshRef = useRef(onRefresh);
  const statusChangeRef = useRef(onStatusChange);
  const normalizedIds = [...new Set(boothIds)].sort((a, b) => a - b);
  const roomKey = normalizedIds.join(",");

  useEffect(() => {
    refreshRef.current = onRefresh;
    statusChangeRef.current = onStatusChange;
  }, [onRefresh, onStatusChange]);

  useEffect(() => {
    if (!normalizedIds.length) {
      statusChangeRef.current?.("polling");
      return;
    }

    let active = true;
    let retryAttempt = 0;
    let retryTimer: number | undefined;
    const sockets = new Map<number, WebSocket>();
    const healthySockets = new Set<number>();
    const heartbeatTimers = new Map<number, number>();
    const pongDeadlineTimers = new Map<number, number>();
    const revisions = new Map<number, number>();
    const requestedRevisions = new Map<number, number>();
    const pendingRevisions = new Map<
      number,
      { revision: number; missed: boolean }
    >();
    let refreshRunning = false;

    const canConnect = () =>
      active &&
      document.visibilityState === "visible" &&
      navigator.onLine;

    const allSocketsHealthy = () =>
      normalizedIds.every(
        (boothId) =>
          sockets.get(boothId)?.readyState === WebSocket.OPEN &&
          healthySockets.has(boothId),
      );

    const updateConnectionState = () => {
      if (!active) return;
      if (!navigator.onLine) {
        statusChangeRef.current?.("paused");
      } else if (allSocketsHealthy()) {
        retryAttempt = 0;
        statusChangeRef.current?.("connected");
      } else if (
        retryAttempt >= FAST_RECONNECT_ATTEMPTS ||
        typeof WebSocket === "undefined"
      ) {
        statusChangeRef.current?.("polling");
      } else {
        statusChangeRef.current?.("reconnecting");
      }
    };

    const drainRefreshes = async () => {
      if (refreshRunning || !active) return;
      refreshRunning = true;
      try {
        while (active && pendingRevisions.size) {
          const pending = [...pendingRevisions.entries()];
          pendingRevisions.clear();
          await refreshRef.current(
            pending.some(([, event]) => event.missed),
          );
          for (const [boothId, event] of pending) {
            revisions.set(
              boothId,
              Math.max(revisions.get(boothId) || 0, event.revision),
            );
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

    const clearSocketTimers = (boothId: number) => {
      window.clearInterval(heartbeatTimers.get(boothId));
      window.clearTimeout(pongDeadlineTimers.get(boothId));
      heartbeatTimers.delete(boothId);
      pongDeadlineTimers.delete(boothId);
      healthySockets.delete(boothId);
    };

    const closeSockets = () => {
      const currentSockets = [...sockets.entries()];
      sockets.clear();
      for (const [boothId, socket] of currentSockets) {
        clearSocketTimers(boothId);
        socket.close(1000, "Page inactive");
      }
      updateConnectionState();
    };

    const connect = () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      if (!canConnect()) {
        updateConnectionState();
        return;
      }
      if (typeof WebSocket === "undefined") {
        retryAttempt = FAST_RECONNECT_ATTEMPTS;
        updateConnectionState();
        return;
      }
      closeSockets();

      const scheduleReconnect = () => {
        updateConnectionState();
        if (!canConnect() || retryTimer !== undefined) return;
        const baseDelay =
          retryAttempt >= FAST_RECONNECT_ATTEMPTS
            ? RECONNECT_COOLDOWN_MS
            : Math.min(
                1_000 * 2 ** retryAttempt,
                MAX_RECONNECT_DELAY_MS,
              );
        const jitteredDelay = Math.round(
          baseDelay * (0.75 + Math.random() * 0.5),
        );
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, jitteredDelay);
      };

      for (const boothId of normalizedIds) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        let socket: WebSocket;
        try {
          socket = new WebSocket(
            `${protocol}//${window.location.host}/api/booths/${boothId}/live`,
          );
        } catch {
          scheduleReconnect();
          continue;
        }
        sockets.set(boothId, socket);

        const sendHeartbeat = () => {
          if (
            sockets.get(boothId) !== socket ||
            socket.readyState !== WebSocket.OPEN ||
            !canConnect()
          ) {
            return;
          }
          socket.send("ping");
          window.clearTimeout(pongDeadlineTimers.get(boothId));
          pongDeadlineTimers.set(
            boothId,
            window.setTimeout(() => {
              if (sockets.get(boothId) !== socket) return;
              healthySockets.delete(boothId);
              updateConnectionState();
              socket.close(4000, "Heartbeat timeout");
            }, PONG_DEADLINE_MS),
          );
        };

        socket.addEventListener("open", () => {
          updateConnectionState();
          sendHeartbeat();
          heartbeatTimers.set(
            boothId,
            window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS),
          );
        });
        socket.addEventListener("message", (message) => {
          if (message.data === "pong") {
            window.clearTimeout(pongDeadlineTimers.get(boothId));
            pongDeadlineTimers.delete(boothId);
            healthySockets.add(boothId);
            updateConnectionState();
            return;
          }
          if (typeof message.data !== "string") return;
          let event: BoothLiveEvent;
          try {
            event = JSON.parse(message.data) as BoothLiveEvent;
          } catch {
            return;
          }
          if (event.boothId !== boothId) return;
          const currentRevision = revisions.get(boothId) || 0;
          if (event.type === "ready") {
            queueRefresh(
              boothId,
              event.revision,
              currentRevision !== event.revision,
              true,
            );
            return;
          }
          if (event.revision <= currentRevision) return;
          queueRefresh(
            boothId,
            event.revision,
            event.revision !== currentRevision + 1,
          );
        });
        const reconnect = () => {
          if (sockets.get(boothId) !== socket) return;
          sockets.delete(boothId);
          clearSocketTimers(boothId);
          updateConnectionState();
          scheduleReconnect();
        };
        socket.addEventListener("close", reconnect, { once: true });
        socket.addEventListener(
          "error",
          () => {
            if (socket.readyState !== WebSocket.CLOSED) socket.close();
          },
          { once: true },
        );
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (navigator.onLine) queueMicrotask(connect);
      } else {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
        closeSockets();
      }
    };
    const handleOnline = () => {
      retryAttempt = 0;
      queueMicrotask(connect);
    };
    const handleOffline = () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      closeSockets();
      updateConnectionState();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      closeSockets();
    };
    // roomKey is the stable representation of the normalized room list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey]);
}
