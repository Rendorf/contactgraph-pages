"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const clamp = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));

/** Zoom state for a scrollable SVG graph: buttons plus two-finger pinch on touch screens. */
export function useGraphZoom() {
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pinch: { distance: number; zoom: number } | null = null;
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
    canvas.addEventListener("touchstart", start, { passive: true });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
    return () => {
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
    <Button size="icon" variant="outline" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom graph out"><Minus /></Button>
    <button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset graph zoom to 100 percent">{Math.round(zoom * 100)}%</button>
    <Button size="icon" variant="outline" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom graph in"><Plus /></Button>
    <Button size="icon" variant="outline" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset graph zoom"><Maximize2 /></Button>
  </div>;
}
