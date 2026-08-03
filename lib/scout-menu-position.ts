export type ScoutMenuPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: "above" | "below";
};

type Rect = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width">;

export function calculateScoutMenuPlacement(
  trigger: Rect,
  viewport: { width: number; height: number },
  desiredHeight: number,
  { margin = 8, gap = 6, minimumHeight = 120 } = {},
): ScoutMenuPlacement {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const usableWidth = Math.max(0, viewportWidth - margin * 2);
  const width = Math.min(Math.max(0, trigger.width), usableWidth);
  const left = Math.min(
    Math.max(margin, trigger.left),
    Math.max(margin, viewportWidth - margin - width),
  );
  const spaceBelow = Math.max(0, viewportHeight - trigger.bottom - gap - margin);
  const spaceAbove = Math.max(0, trigger.top - gap - margin);
  const requiredHeight = Math.min(Math.max(0, desiredHeight), minimumHeight);
  const side = spaceBelow >= requiredHeight || spaceBelow >= spaceAbove ? "below" : "above";
  const availableHeight = side === "below" ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(0, Math.min(Math.max(0, desiredHeight), availableHeight));
  const top = side === "below"
    ? Math.min(viewportHeight - margin, trigger.bottom + gap)
    : Math.max(margin, trigger.top - gap - maxHeight);

  return { left, top, width, maxHeight, side };
}
