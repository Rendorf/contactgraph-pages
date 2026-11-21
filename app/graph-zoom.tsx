"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Move, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canStartGraphPan, graphCenteredScroll, graphPanDistance, graphPanScroll, GRAPH_PAN_THRESHOLD, type GraphPanOrigin } from "./graph-pan";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const clamp = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));

/** Zoom and pan state for a scrollable SVG graph. */
export function useGraphZoom() {
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pan: (GraphPanOrigin & { pointerId: number; dragged: boolean }) | null = null;
    let suppressClickUntil = 0;
    let pinch: { distance: number; zoom: number } | null = null;
    let centerFrame = 0;
    let centeredSvg: SVGSVGElement | null = null;
    const centerNewGraph = () => {
      const svg = canvas.querySelector<SVGSVGElement>(":scope > svg");
      if (!svg || svg === centeredSvg) return;
      centeredSvg = svg;
      cancelAnimationFrame(centerFrame);
      centerFrame = requestAnimationFrame(() => {
        const centered = graphCenteredScroll(canvas.scrollWidth, canvas.clientWidth, canvas.scrollHeight, canvas.clientHeight);
        canvas.scrollLeft = centered.left;
        canvas.scrollTop = centered.top;
      });
    };
    centerNewGraph();
    const graphObserver = new MutationObserver(centerNewGraph);
    graphObserver.observe(canvas, { childList: true });
    const isInteractive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
    const startPan = (event: PointerEvent) => {
      if (!canStartGraphPan({ button: event.button, isPrimary: event.isPrimary, pointerType: event.pointerType, interactiveTarget: isInteractive(event.target) })) return;
      pan = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: canvas.scrollLeft, scrollTop: canvas.scrollTop, dragged: false };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.panning = "true";
    };
    const movePan = (event: PointerEvent) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      if (!pan.dragged && graphPanDistance(pan, event.clientX, event.clientY) < GRAPH_PAN_THRESHOLD) return;
      pan.dragged = true;
      event.preventDefault();
      const next = graphPanScroll(pan, event.clientX, event.clientY);
      canvas.scrollLeft = next.left;
      canvas.scrollTop = next.top;
    };
    const endPan = (event?: PointerEvent) => {
      if (!pan || (event && event.pointerId !== pan.pointerId)) return;
      const { pointerId, dragged } = pan;
      pan = null;
      if (dragged) suppressClickUntil = performance.now() + 300;
      delete canvas.dataset.panning;
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    };
    const suppressDraggedClick = (event: MouseEvent) => {
      if (performance.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntil = 0;
    };
    const distance = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: distance(event), zoom: zoomRef.current };
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      if (!pinch) pinch = { distance: distance(event), zoom: zoomRef.current };
      setZoom(clamp(pinch.zoom * distance(event) / Math.max(1, pinch.distance)));
    };
    const end = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; };
    canvas.addEventListener("pointerdown", startPan);
    canvas.addEventListener("pointermove", movePan);
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("lostpointercapture", endPan);
    canvas.addEventListener("click", suppressDraggedClick, true);
    canvas.addEventListener("touchstart", start, { passive: true });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
    return () => {
      graphObserver.disconnect();
      cancelAnimationFrame(centerFrame);
      canvas.removeEventListener("pointerdown", startPan);
      canvas.removeEventListener("pointermove", movePan);
      canvas.removeEventListener("pointerup", endPan);
      canvas.removeEventListener("pointercancel", endPan);
      canvas.removeEventListener("lostpointercapture", endPan);
      canvas.removeEventListener("click", suppressDraggedClick, true);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
      canvas.removeEventListener("touchcancel", end);
    };
  }, []);
  return { zoom, setZoom, canvasRef, zoomIn: () => setZoom((value) => clamp(value + 0.25)), zoomOut: () => setZoom((value) => clamp(value - 0.25)) };
}

export function GraphZoomControls({ zoom, setZoom, zoomIn, zoomOut }: Pick<ReturnType<typeof useGraphZoom>, "zoom" | "setZoom" | "zoomIn" | "zoomOut">) {
  return <div className="zoom-controls" aria-label="Graph zoom controls">
    <span className="graph-pan-help"><Move />Drag to pan</span>
    <Button size="icon" variant="outline" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom graph out"><Minus /></Button>
    <button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset graph zoom to 100 percent">{Math.round(zoom * 100)}%</button>
    <Button size="icon" variant="outline" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom graph in"><Plus /></Button>
    <Button size="icon" variant="outline" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset graph zoom"><Maximize2 /></Button>
  </div>;
}
