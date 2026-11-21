export const GRAPH_PAN_THRESHOLD = 4;

export type GraphPanOrigin = {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
};

export function canStartGraphPan({ button, isPrimary, pointerType, interactiveTarget }: {
  button: number;
  isPrimary: boolean;
  pointerType: string;
  interactiveTarget: boolean;
}) {
  return button === 0 && isPrimary && pointerType === "mouse" && !interactiveTarget;
}

export function graphPanDistance(origin: Pick<GraphPanOrigin, "clientX" | "clientY">, clientX: number, clientY: number) {
  return Math.hypot(clientX - origin.clientX, clientY - origin.clientY);
}

export function graphPanScroll(origin: GraphPanOrigin, clientX: number, clientY: number) {
  return {
    left: origin.scrollLeft - (clientX - origin.clientX),
    top: origin.scrollTop - (clientY - origin.clientY),
  };
}

export function graphCenteredScroll(scrollWidth: number, clientWidth: number, scrollHeight: number, clientHeight: number) {
  return {
    left: Math.max(0, (scrollWidth - clientWidth) / 2),
    top: Math.max(0, (scrollHeight - clientHeight) / 2),
  };
}
