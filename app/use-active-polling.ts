"use client";

import { useCallback, useEffect, useRef } from "react";
import { rateLimitWaitSeconds } from "../lib/client-rate-limit";

export function useActivePolling(
  task: (signal: AbortSignal) => Promise<void>,
  {
    enabled = true,
    intervalMs = 15_000,
  }: {
    enabled?: boolean;
    intervalMs?: number;
  } = {},
) {
  const taskRef = useRef(task);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const refresh = useCallback((force = false) => {
    if ((!enabled && !force) || document.visibilityState !== "visible") {
      return Promise.resolve();
    }
    if (inFlightRef.current) return inFlightRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    const request = taskRef.current(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (inFlightRef.current === request) inFlightRef.current = null;
      });
    inFlightRef.current = request;
    return request;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      controllerRef.current?.abort();
      return;
    }

    let timer: number | undefined;
    let active = true;

    const schedule = () => {
      if (!active || document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      const retryDelay = rateLimitWaitSeconds("polling") * 1000;
      timer = window.setTimeout(() => {
        void refresh().finally(schedule);
      }, Math.max(intervalMs, retryDelay));
    };
    const synchronize = () => {
      window.clearTimeout(timer);
      if (!active || document.visibilityState !== "visible") return;
      void refresh().finally(schedule);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const finishingRequest = inFlightRef.current;
        if (finishingRequest) {
          void finishingRequest.finally(synchronize);
        } else {
          synchronize();
        }
      } else {
        window.clearTimeout(timer);
        controllerRef.current?.abort();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    synchronize();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      controllerRef.current?.abort();
    };
  }, [enabled, intervalMs, refresh]);

  return refresh;
}
