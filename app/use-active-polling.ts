"use client";

import { useCallback, useEffect, useRef } from "react";
import { rateLimitWaitSeconds } from "../lib/client-rate-limit";
import { OwnedAbortRequestSlot } from "../lib/request-ownership";

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
  const enabledRef = useRef(enabled);
  const ownerRef = useRef(0);
  const requestSlotRef = useRef(new OwnedAbortRequestSlot());
  const forcePendingRef = useRef(false);

  useEffect(() => {
    taskRef.current = task;
    enabledRef.current = enabled;
  }, [enabled, task]);

  const cancelRequest = useCallback((owner?: number) => {
    requestSlotRef.current.cancel(owner);
  }, []);

  const refresh = useCallback((force = false) => {
    if (document.visibilityState !== "visible") {
      if (force) forcePendingRef.current = true;
      return Promise.resolve();
    }
    if (!enabledRef.current && !force) return Promise.resolve();
    forcePendingRef.current = false;
    return requestSlotRef.current.start(ownerRef.current, async (signal) => {
      try {
        await taskRef.current(signal);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    });
  }, []);

  useEffect(() => {
    const owner = ownerRef.current + 1;
    ownerRef.current = owner;
    forcePendingRef.current = false;
    cancelRequest();

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
    const synchronize = (force = false) => {
      window.clearTimeout(timer);
      if (!active || document.visibilityState !== "visible") return;
      void refresh(force).finally(schedule);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const finishingRequest = requestSlotRef.current.promise;
        const force = forcePendingRef.current;
        if (finishingRequest) {
          void finishingRequest.finally(() => synchronize(force));
        } else {
          synchronize(force);
        }
      } else {
        window.clearTimeout(timer);
        cancelRequest(owner);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (enabled) synchronize();
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cancelRequest(owner);
    };
  }, [cancelRequest, enabled, intervalMs, refresh]);

  return refresh;
}
