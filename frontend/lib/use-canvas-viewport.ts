"use client";

import { useEffect, useRef, useState, type PointerEvent, type MouseEvent, type KeyboardEvent } from "react";

interface CanvasTransform {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const MIN_ZOOM = 0.0001;
const MAX_ZOOM = 2;

export function useCanvasViewport() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<CanvasTransform>({ x: 24, y: 64, zoom: 1 });
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; origin: CanvasTransform; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);

  function zoomAt(zoom: number, x: number, y: number) {
    setTransform((current) => {
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      const ratio = nextZoom / current.zoom;
      return { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom: nextZoom };
    });
  }

  function setZoom(zoom: number) {
    const viewport = viewportRef.current;
    zoomAt(zoom, (viewport?.clientWidth ?? 0) / 2, (viewport?.clientHeight ?? 0) / 2);
  }

  function fit(width: number, height: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(1, (viewport.clientWidth - 48) / width, (viewport.clientHeight - 88) / height));
    setTransform({ x: (viewport.clientWidth - width * zoom) / 2, y: 64 + Math.max(0, (viewport.clientHeight - 88 - height * zoom) / 2), zoom });
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = viewport!.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1;
      setTransform((current) => {
        if (!event.ctrlKey && !event.metaKey) return { ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit };
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * Math.exp(-event.deltaY * unit * 0.002)));
        const x = event.clientX - rect.left, y = event.clientY - rect.top, ratio = zoom / current.zoom;
        return { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom };
      });
    }
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest("[data-canvas-controls]")) return;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: transform, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const x = event.clientX - active.x, y = event.clientY - active.y;
    if (!active.moved && Math.hypot(x, y) < 4) return;
    event.preventDefault();
    if (!active.moved) {
      active.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    suppressClick.current = true;
    setTransform({ ...active.origin, x: active.origin.x + x, y: active.origin.y + y });
  }

  function endGesture(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 120 : 40;
    const offsets: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    setTransform((current) => ({ ...current, x: current.x + offset[0], y: current.y + offset[1] }));
  }

  return {
    viewportRef, transform, dragging, setZoom, fit, canZoomIn: transform.zoom < MAX_ZOOM, canZoomOut: transform.zoom > MIN_ZOOM,
    viewportProps: { onPointerDown, onPointerMove, onPointerUp: endGesture, onPointerCancel: endGesture, onLostPointerCapture: endGesture, onPointerLeave: (event: PointerEvent<HTMLDivElement>) => { if (!gesture.current?.moved) endGesture(event); }, onClickCapture, onKeyDown }
  };
}
