import React from "react";

export function formatStartedAt(startedAt: number | null): string {
  if (!startedAt) return "Not started";
  const date = new Date(startedAt);
  return date.toLocaleString();
}

export const pointerButtonFromMouseEvent = (
  button: number,
): "left" | "middle" | "right" => {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
};

export const normalizedPointerPosition = (
  event:
    | React.MouseEvent<HTMLButtonElement>
    | React.WheelEvent<HTMLButtonElement>,
  surface: HTMLButtonElement | null,
) => {
  if (!surface) {
    return { x: 0.5, y: 0.5 };
  }

  const rect = surface.getBoundingClientRect();
  const x = Math.min(
    1,
    Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
  );
  const y = Math.min(
    1,
    Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
  );

  return {
    x: Number.isFinite(x) ? x : 0.5,
    y: Number.isFinite(y) ? y : 0.5,
  };
};
