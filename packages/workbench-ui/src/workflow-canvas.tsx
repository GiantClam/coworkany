"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ClipboardPaste, Copy, Link2, Minus, MousePointer2, Move, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import {
  areWorkflowPortsCompatible,
  getWorkflowNodeDefinition,
  getWorkflowNodeOutputKinds,
  isWorkflowNodeType,
  resolveWorkflowNodeTitle,
  type WorkflowDefinitionEdgeV2,
  type WorkflowDefinitionNodeV2,
  type WorkflowNodeType,
  type WorkflowPortDefinition,
  type WorkflowValueKind,
} from "@coworkany/workflow-core";
import { Canvas, Connection, Controls, Edge, Node, Panel, Toolbar } from "./ai-elements/index";
import { getWorkbenchTaskStatusLabel, normalizeWorkbenchTaskStatus } from "./task-status";

export type WorkflowCanvasNode = Omit<WorkflowDefinitionNodeV2, "type" | "nodeVersion"> & {
  type: WorkflowNodeType | string;
  nodeVersion?: number;
};
export type WorkflowCanvasEdge = WorkflowDefinitionEdgeV2;
export type WorkflowCanvasExecutionSnapshot = {
  nodeKey: string;
  status: string;
  outputPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

/** Pointer-event bridge used by the desktop node palette. HTML5 drag events are unreliable in native WebViews. */
export const WORKFLOW_PALETTE_DRAG_EVENT = "coworkany:workflow-palette-drag-start";
export const WORKFLOW_PALETTE_DROP_EVENT = "coworkany:workflow-palette-drop";
type WorkflowPaletteDragDetail = { type: string; pointerId: number; startClientX?: number; startClientY?: number };
export type WorkflowCanvasProps = {
  className?: string;
  locale: "zh" | "en";
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  selectedNodeKey?: string | null;
  pendingConnectionSourceKey?: string | null;
  nodeExecutionSnapshots?: WorkflowCanvasExecutionSnapshot[];
  initialViewport?: { x: number; y: number; scale: number };
  providerConfiguredForNode?: (nodeType: string) => boolean;
  requiresProviderForNode?: (nodeType: string) => boolean;
  isConnectionSlotEnabled?: (target: WorkflowCanvasNode, targetPortId: string) => boolean;
  onSelectNode: (nodeKey: string | null) => void;
  onMoveNode: (nodeKey: string, position: { x: number; y: number }) => void;
  onMoveNodes?: (moves: Array<{ nodeKey: string; position: { x: number; y: number } }>) => void;
  onDeleteNode?: (nodeKey: string) => void;
  onDeleteEdge?: (edge: WorkflowCanvasEdge) => void;
  onDuplicateNode?: (nodeKey: string) => void;
  onDuplicateNodes?: (nodeKeys: string[], offset: { x: number; y: number }) => string[];
  onStartConnection?: (nodeKey: string) => void;
  onConnect?: (sourceNodeKey: string, targetNodeKey: string, sourcePortId: string, targetPortId: string) => void;
  onCancelConnection?: () => void;
  onAddNodeAtPoint?: (type: WorkflowNodeType, position: { x: number; y: number }) => void;
  onUpdateNode?: (nodeKey: string, patch: Partial<WorkflowCanvasNode>) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  renderNodeEditor?: (node: WorkflowCanvasNode) => ReactNode;
  renderNodeOutput?: (node: WorkflowCanvasNode, snapshot: WorkflowCanvasExecutionSnapshot) => ReactNode;
};

const NODE_WIDTH = 336;
const NODE_SELECTION_HEIGHT = 240;
const INPUT_PORT_CENTER_X = 22;
const OUTPUT_PORT_CENTER_X = NODE_WIDTH - 22;
const NODE_PORT_CENTER_Y = 42;
const CONNECTION_SNAP_RADIUS = 44;
const MIN_CANVAS_SCALE = 0.3;
const MAX_CANVAS_SCALE = 1.6;
const ZOOM_STEP = 0.12;
const CANVAS_WORLD_MARGIN = 360;

type Viewport = { x: number; y: number; scale: number };
type CanvasPoint = { x: number; y: number };
type DragState =
  | {
      kind: "node";
      nodeKeys: string[];
      startClientX: number;
      startClientY: number;
      startPositions: Record<string, CanvasPoint>;
      currentPositions?: Record<string, CanvasPoint>;
    }
  | {
      kind: "pan";
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      kind: "selection";
      startX: number;
      startY: number;
    }
  | null;
type ConnectionDrag = {
  sourceNodeKey: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};
type ConnectionTarget = {
  targetNodeKey: string;
  candidates: ConnectionPortPair[];
};
type ConnectionPortPair = { sourcePortId: string; targetPortId: string; kind: WorkflowValueKind };
type PendingPortChoice = ConnectionTarget & { sourceNodeKey: string; x: number; y: number };
type SelectedEdge = { edge: WorkflowCanvasEdge; sourcePortId: string; targetPortId: string };
type SelectionBox = { startX: number; startY: number; endX: number; endY: number };
type PaletteDragState = { type: WorkflowNodeType; pointerId: number; startClientX: number; startClientY: number; moved: boolean };

const clampScale = (value: number) =>
  Math.max(MIN_CANVAS_SCALE, Math.min(MAX_CANVAS_SCALE, Number(value.toFixed(2))));
const isInteractiveTarget = (target: EventTarget | null, mediaInteractionEnabled: boolean) =>
  target instanceof Element && Boolean(target.closest("button,input,textarea,select,option,label,a,[data-node-no-drag='true']") || (mediaInteractionEnabled && target.closest("[data-node-media='true']")));
const nodeHasPreviewableMedia = (node: WorkflowCanvasNode) =>
  node.type === "upload" && Array.isArray(node.config.uploadedFiles) && node.config.uploadedFiles.some((file) =>
    Boolean(file && typeof file === "object" && typeof (file as { mimeType?: unknown }).mimeType === "string" && /^(image|video)\//u.test((file as { mimeType: string }).mimeType)),
  );
const boundsForSelection = (selection: SelectionBox) => ({
  left: Math.min(selection.startX, selection.endX),
  top: Math.min(selection.startY, selection.endY),
  right: Math.max(selection.startX, selection.endX),
  bottom: Math.max(selection.startY, selection.endY),
});
const intersectsSelection = (node: WorkflowCanvasNode, selection: SelectionBox) => {
  const bounds = boundsForSelection(selection);
  return node.positionX < bounds.right && node.positionX + NODE_WIDTH > bounds.left && node.positionY < bounds.bottom && node.positionY + NODE_SELECTION_HEIGHT > bounds.top;
};
const getDefinition = (node: WorkflowCanvasNode) =>
  isWorkflowNodeType(node.type) ? getWorkflowNodeDefinition(node.type) : null;
const buildPath = (sx: number, sy: number, ex: number, ey: number) => {
  const curve = Math.max(72, Math.abs(ex - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`;
};
const statusTone = (status?: string | null) => {
  const normalized = status === "skipped" ? "skipped" : normalizeWorkbenchTaskStatus(status);
  return normalized === "running"
    ? ["#38bdf8", "#e0f2fe", "#0369a1"]
    : normalized === "completed"
      ? ["#86efac", "#dcfce7", "#15803d"]
    : normalized === "failed"
      ? ["#fca5a5", "#fee2e2", "#b91c1c"]
      : normalized === "cancelled"
        ? ["#cbd5e1", "#f1f5f9", "#475569"]
        : normalized === "skipped"
          ? ["#d1d5db", "#f9fafb", "#6b7280"]
      : normalized === "waiting"
        ? ["#c4b5fd", "#f5f3ff", "#6d28d9"]
      : normalized === "queued"
          ? ["#fcd34d", "#fef3c7", "#a16207"]
          : ["var(--wb-border, #e5e5e0)", "var(--wb-background, #fdfdfb)", "var(--wb-muted-foreground, #777)"];
};
const statusLabel = (locale: "zh" | "en", status: string) => status === "skipped" ? (locale === "zh" ? "已跳过" : "Skipped") : getWorkbenchTaskStatusLabel(normalizeWorkbenchTaskStatus(status), locale);
const mediaPortLabel = (port: WorkflowPortDefinition | undefined, locale: "zh" | "en") => {
  const labels: Record<string, { zh: string; en: string }> = {
    "text.prompt": { zh: "提示词", en: "Prompt" },
    "image.first_frame": { zh: "首帧", en: "First frame" },
    "image.last_frame": { zh: "尾帧", en: "Last frame" },
    "image.reference": { zh: "参考图", en: "Reference images" },
    "video.source": { zh: "源视频", en: "Source video" },
    "video.reference": { zh: "参考视频", en: "Reference videos" },
    "audio.reference": { zh: "参考音频", en: "Reference audio" },
  };
  return port?.role ? labels[port.role]?.[locale] ?? port.id : port?.id ?? "";
};

function resolvePorts(
  source: WorkflowCanvasNode,
  target: WorkflowCanvasNode,
  sourcePortId?: string | null,
  targetPortId?: string | null,
) {
  const sourceDefinition = getDefinition(source);
  const targetDefinition = getDefinition(target);
  if (!sourceDefinition || !targetDefinition) return null;
  const targetPort = targetDefinition.inputs.find((port) => port.id === targetPortId) ?? targetDefinition.inputs[0];
  const sourcePort =
    sourceDefinition.outputs.find((port) => port.id === sourcePortId) ??
    sourceDefinition.outputs.find((port) => targetPort && areWorkflowPortsCompatible(port, targetPort));
  return sourcePort && targetPort && areWorkflowPortsCompatible(sourcePort, targetPort)
    ? { sourcePort, targetPort }
    : null;
}

function formatParameterValue(value: unknown) {
  if (typeof value === "string") return value.replace(/\s+/gu, " ").trim();
  return String(value);
}

export function calculateWorkflowCanvasSceneBounds(
  nodes: readonly Pick<WorkflowCanvasNode, "positionX" | "positionY">[],
  viewport: { x: number; y: number; scale: number },
  viewportSize: { width: number; height: number },
) {
  const visibleWidth = viewportSize.width || 1200;
  const visibleHeight = viewportSize.height || 900;
  const viewLeft = -viewport.x / viewport.scale;
  const viewTop = -viewport.y / viewport.scale;
  const viewRight = (visibleWidth - viewport.x) / viewport.scale;
  const viewBottom = (visibleHeight - viewport.y) / viewport.scale;
  const minX = Math.min(viewLeft, ...nodes.map((node) => node.positionX)) - CANVAS_WORLD_MARGIN;
  const minY = Math.min(viewTop, ...nodes.map((node) => node.positionY)) - CANVAS_WORLD_MARGIN;
  const maxX = Math.max(viewRight, ...nodes.map((node) => node.positionX + NODE_WIDTH)) + CANVAS_WORLD_MARGIN;
  const maxY = Math.max(viewBottom, ...nodes.map((node) => node.positionY + NODE_SELECTION_HEIGHT)) + CANVAS_WORLD_MARGIN;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export function WorkflowCanvas({
  className,
  locale,
  nodes,
  edges,
  selectedNodeKey = null,
  pendingConnectionSourceKey = null,
  nodeExecutionSnapshots = [],
  initialViewport = { x: 80, y: 40, scale: 1 },
  providerConfiguredForNode = () => true,
  requiresProviderForNode = () => false,
  isConnectionSlotEnabled = () => true,
  onSelectNode,
  onMoveNode,
  onMoveNodes,
  onDeleteNode,
  onDeleteEdge,
  onDuplicateNode,
  onDuplicateNodes,
  onStartConnection,
  onConnect,
  onCancelConnection,
  onAddNodeAtPoint,
  onUpdateNode,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  renderNodeEditor,
  renderNodeOutput,
}: WorkflowCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPreviewRef = useRef<Record<string, CanvasPoint> | null>(null);
  const paletteDragRef = useRef<PaletteDragState | null>(null);
  const connectionRef = useRef<ConnectionDrag | null>(null);
  const pasteSequenceRef = useRef(0);
  const viewportRef = useRef<Viewport>(initialViewport);
  const initialViewportSignature = `${initialViewport.x}:${initialViewport.y}:${initialViewport.scale}`;
  const initialViewportSignatureRef = useRef(initialViewportSignature);
  const [viewport, setViewport] = useState<Viewport>(viewportRef.current);
  const [dragPreview, setDragPreview] = useState<Record<string, CanvasPoint> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<string[]>(selectedNodeKey ? [selectedNodeKey] : []);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDragState | null>(null);
  const [clipboardNodeKeys, setClipboardNodeKeys] = useState<string[]>([]);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<ConnectionTarget | null>(null);
  const [pendingPortChoice, setPendingPortChoice] = useState<PendingPortChoice | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [mediaInteractionNodeKey, setMediaInteractionNodeKey] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.nodeKey, node])), [nodes]);
  const renderedNodes = useMemo(
    () =>
      dragPreview
        ? nodes.map((node) =>
            dragPreview[node.nodeKey]
              ? { ...node, positionX: dragPreview[node.nodeKey].x, positionY: dragPreview[node.nodeKey].y }
              : node,
          )
        : nodes,
    [dragPreview, nodes],
  );
  const renderedNodeMap = useMemo(
    () => new Map(renderedNodes.map((node) => [node.nodeKey, node])),
    [renderedNodes],
  );
  const executionMap = useMemo(
    () => new Map(nodeExecutionSnapshots.map((item) => [item.nodeKey, item])),
    [nodeExecutionSnapshots],
  );
  const copyableSelectedNodeKeys = useMemo(
    () => selectedNodeKeys.filter((nodeKey) => nodeKey !== "input"),
    [selectedNodeKeys],
  );

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    if (!selectedNodeKey) return;
    setSelectedNodeKeys((current) => current.includes(selectedNodeKey) ? current : [selectedNodeKey]);
  }, [selectedNodeKey]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (initialViewportSignatureRef.current === initialViewportSignature) return;
    initialViewportSignatureRef.current = initialViewportSignature;
    const nextViewport = { ...initialViewport };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  }, [initialViewport, initialViewportSignature]);
  useEffect(() => {
    connectionRef.current = connectionDrag;
  }, [connectionDrag]);
  useEffect(() => {
    if (selectedEdge && !edges.some((edge) => edge.edgeKey === selectedEdge.edge.edgeKey)) {
      setSelectedEdge(null);
    }
  }, [edges, selectedEdge]);
  const copySelectedNodes = useCallback(() => {
    if (!copyableSelectedNodeKeys.length) return;
    pasteSequenceRef.current = 0;
    setClipboardNodeKeys(copyableSelectedNodeKeys);
  }, [copyableSelectedNodeKeys]);
  const pasteSelectedNodes = useCallback(() => {
    if (!clipboardNodeKeys.length || !onDuplicateNodes) return;
    pasteSequenceRef.current += 1;
    const offset = 48 * pasteSequenceRef.current;
    const nextKeys = onDuplicateNodes(clipboardNodeKeys, { x: offset, y: offset });
    if (!nextKeys.length) return;
    setSelectedNodeKeys(nextKeys);
    onSelectNode(nextKeys[0]);
  }, [clipboardNodeKeys, onDuplicateNodes, onSelectNode]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable='true']")) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo?.();
        else onUndo?.();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo?.();
      } else if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedNodes();
      } else if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteSelectedNodes();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedNodes, onRedo, onUndo, pasteSelectedNodes]);

  const getInputPortCenter = useCallback((node: WorkflowCanvasNode): CanvasPoint => {
    return { x: node.positionX + INPUT_PORT_CENTER_X, y: node.positionY + NODE_PORT_CENTER_Y };
  }, []);
  const getOutputPortCenter = useCallback((node: WorkflowCanvasNode): CanvasPoint => {
    return { x: node.positionX + OUTPUT_PORT_CENTER_X, y: node.positionY + NODE_PORT_CENTER_Y };
  }, []);
  const canvasPointFromClient = useCallback((clientX: number, clientY: number): CanvasPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const current = viewportRef.current;
    return {
      x: Math.round((clientX - rect.left - current.x) / current.scale),
      y: Math.round((clientY - rect.top - current.y) / current.scale),
    };
  }, []);
  const resolveTarget = useCallback(
    (sourceNodeKey: string, point: CanvasPoint): ConnectionTarget | null => {
      const source = renderedNodeMap.get(sourceNodeKey) ?? nodeMap.get(sourceNodeKey);
      const sourceDefinition = source && getDefinition(source);
      if (!source || !sourceDefinition?.outputs.length) return null;
      let nearest: ConnectionTarget | null = null;
      let nearestDistance = CONNECTION_SNAP_RADIUS ** 2;
      for (const target of renderedNodes) {
        if (target.nodeKey === sourceNodeKey) continue;
        const targetDefinition = getDefinition(target);
        if (!targetDefinition) continue;
        const candidates = targetDefinition.inputs.flatMap((targetPort) => {
          if (!isConnectionSlotEnabled(target, targetPort.id)) return [];
          const compatible = sourceDefinition.outputs.filter((sourcePort) => areWorkflowPortsCompatible(sourcePort, targetPort));
          const exact = compatible.filter((sourcePort) => sourcePort.valueKind === targetPort.valueKind);
          return (exact.length ? exact : compatible).map((sourcePort) => ({ sourcePortId: sourcePort.id, targetPortId: targetPort.id, kind: targetPort.valueKind }));
        });
        if (!candidates.length) continue;
        const center = getInputPortCenter(target);
        const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearest = { targetNodeKey: target.nodeKey, candidates };
        }
      }
      return nearest;
    },
    [getInputPortCenter, isConnectionSlotEnabled, nodeMap, renderedNodeMap, renderedNodes],
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const paletteDrag = paletteDragRef.current;
      if (paletteDrag?.pointerId === event.pointerId) {
        if (!paletteDrag.moved && (Math.abs(event.clientX - paletteDrag.startClientX) > 6 || Math.abs(event.clientY - paletteDrag.startClientY) > 6)) {
          const next = { ...paletteDrag, moved: true };
          paletteDragRef.current = next;
          setPaletteDrag(next);
        }
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        setViewport((current) => ({
          ...current,
          x: drag.startX + event.clientX - drag.startClientX,
          y: drag.startY + event.clientY - drag.startClientY,
        }));
        return;
      }
      if (drag.kind === "selection") {
        const point = canvasPointFromClient(event.clientX, event.clientY);
        setSelectionBox({ startX: drag.startX, startY: drag.startY, endX: point.x, endY: point.y });
        return;
      }
      const scale = viewportRef.current.scale;
      const deltaX = Math.round((event.clientX - drag.startClientX) / scale);
      const deltaY = Math.round((event.clientY - drag.startClientY) / scale);
      const nextPositions = Object.fromEntries(drag.nodeKeys.map((nodeKey) => {
        const origin = drag.startPositions[nodeKey];
        return [nodeKey, { x: origin.x + deltaX, y: origin.y + deltaY }];
      }));
      drag.currentPositions = nextPositions;
      pendingDragPreviewRef.current = nextPositions;
      if (dragFrameRef.current !== null) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const preview = pendingDragPreviewRef.current;
        pendingDragPreviewRef.current = null;
        if (preview) setDragPreview(preview);
      });
    };
    const handleUp = (event: PointerEvent) => {
      if (paletteDragRef.current?.pointerId === event.pointerId) return;
      const drag = dragRef.current;
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      pendingDragPreviewRef.current = null;
      if (drag?.kind === "selection") {
        const selected = selectionBox ? nodes.filter((node) => intersectsSelection(node, selectionBox)).map((node) => node.nodeKey) : [];
        setSelectedNodeKeys(selected);
        if (selected.length) onSelectNode(selected[0]);
      }
      if (drag?.kind === "node" && drag.currentPositions) {
        const moves = Object.entries(drag.currentPositions).map(([nodeKey, position]) => ({ nodeKey, position }));
        if (onMoveNodes) onMoveNodes(moves);
        else moves.forEach((move) => onMoveNode(move.nodeKey, move.position));
      }
      dragRef.current = null;
      setDragPreview(null);
      setSelectionBox(null);
      setDragging(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [canvasPointFromClient, nodes, onMoveNode, onMoveNodes, onSelectNode, selectionBox]);

  useEffect(() => {
    const handlePaletteDragStart = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowPaletteDragDetail>).detail;
      if (!detail || !isWorkflowNodeType(detail.type) || !onAddNodeAtPoint) return;
      const next = { type: detail.type, pointerId: detail.pointerId, startClientX: detail.startClientX ?? 0, startClientY: detail.startClientY ?? 0, moved: false };
      paletteDragRef.current = next;
      setPaletteDrag(next);
    };
    const handlePaletteDragEnd = (event: PointerEvent) => {
      const active = paletteDragRef.current;
      if (!active || active.pointerId !== event.pointerId) return;
      paletteDragRef.current = null;
      setPaletteDrag(null);
      if (!active.moved) return;
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      const point = canvasPointFromClient(event.clientX, event.clientY);
      onAddNodeAtPoint?.(active.type, {
        x: point.x - NODE_WIDTH / 2,
        y: point.y - 130,
      });
      window.dispatchEvent(new CustomEvent(WORKFLOW_PALETTE_DROP_EVENT, { detail: { pointerId: active.pointerId } }));
    };
    const cancelPaletteDrag = (event: PointerEvent) => {
      if (paletteDragRef.current?.pointerId !== event.pointerId) return;
      paletteDragRef.current = null;
      setPaletteDrag(null);
    };
    window.addEventListener(WORKFLOW_PALETTE_DRAG_EVENT, handlePaletteDragStart);
    window.addEventListener("pointerup", handlePaletteDragEnd);
    window.addEventListener("pointercancel", cancelPaletteDrag);
    return () => {
      window.removeEventListener(WORKFLOW_PALETTE_DRAG_EVENT, handlePaletteDragStart);
      window.removeEventListener("pointerup", handlePaletteDragEnd);
      window.removeEventListener("pointercancel", cancelPaletteDrag);
    };
  }, [canvasPointFromClient, onAddNodeAtPoint]);

  useEffect(() => {
    if (!connectionDrag) return undefined;
    const handleMove = (event: PointerEvent) => {
      const active = connectionRef.current;
      if (!active) return;
      const point = canvasPointFromClient(event.clientX, event.clientY);
      const target = resolveTarget(active.sourceNodeKey, point);
      setConnectionDrag({ ...active, currentX: point.x, currentY: point.y });
      setHoveredTarget(target);
    };
    const handleUp = (event: PointerEvent) => {
      const active = connectionRef.current;
      if (!active) return;
      const point = canvasPointFromClient(event.clientX, event.clientY);
      // Re-resolve on release so a pointer that leaves a port cannot commit a stale hover target.
      const target = resolveTarget(active.sourceNodeKey, point);
      if (target?.candidates.length === 1) {
        const candidate = target.candidates[0];
        onConnect?.(active.sourceNodeKey, target.targetNodeKey, candidate.sourcePortId, candidate.targetPortId);
        onCancelConnection?.();
      } else if (target) {
        const targetNode = renderedNodeMap.get(target.targetNodeKey);
        const anchor = targetNode ? getInputPortCenter(targetNode) : point;
        setPendingPortChoice({ ...target, sourceNodeKey: active.sourceNodeKey, x: anchor.x, y: anchor.y });
      } else onCancelConnection?.();
      connectionRef.current = null;
      setConnectionDrag(null);
      setHoveredTarget(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [canvasPointFromClient, connectionDrag !== null, getInputPortCenter, onCancelConnection, onConnect, renderedNodeMap, resolveTarget]);

  const startNodeDrag = (event: ReactPointerEvent<HTMLElement>, node: WorkflowCanvasNode) => {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeKeys((current) => current.includes(node.nodeKey) ? current.filter((key) => key !== node.nodeKey) : [...current, node.nodeKey]);
      onSelectNode(node.nodeKey);
      return;
    }
    const nodeKeys = selectedNodeKeys.includes(node.nodeKey) ? selectedNodeKeys : [node.nodeKey];
    setSelectedNodeKeys(nodeKeys);
    if (event.button !== 0 || isInteractiveTarget(event.target, mediaInteractionNodeKey === node.nodeKey)) {
      onSelectNode(node.nodeKey);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelectedEdge(null);
    onSelectNode(node.nodeKey);
    dragRef.current = {
      kind: "node",
      nodeKeys,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions: Object.fromEntries(nodeKeys.map((nodeKey) => {
        const current = nodeMap.get(nodeKey);
        return [nodeKey, { x: current?.positionX ?? 0, y: current?.positionY ?? 0 }];
      })),
    };
    setDragPreview(Object.fromEntries(nodeKeys.map((nodeKey) => {
      const current = nodeMap.get(nodeKey);
      return [nodeKey, { x: current?.positionX ?? 0, y: current?.positionY ?? 0 }];
    })));
    setDragging(true);
  };
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target, false)) return;
    event.preventDefault();
    setSelectedEdge(null);
    onCancelConnection?.();
    setPendingPortChoice(null);
    if (event.shiftKey) {
      const point = canvasPointFromClient(event.clientX, event.clientY);
      dragRef.current = { kind: "selection", startX: point.x, startY: point.y };
      setSelectionBox({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
      setDragging(true);
      return;
    }
    setSelectedNodeKeys([]);
    onSelectNode(null);
    dragRef.current = {
      kind: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    };
    setDragging(true);
  };
  const startConnectionDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: WorkflowCanvasNode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const start = getOutputPortCenter(node);
    onSelectNode(node.nodeKey);
    onStartConnection?.(node.nodeKey);
    setSelectedEdge(null);
    setPendingPortChoice(null);
    const next = {
      sourceNodeKey: node.nodeKey,
      startX: start.x,
      startY: start.y,
      currentX: start.x,
      currentY: start.y,
    };
    connectionRef.current = next;
    setConnectionDrag(next);
  };
  const beginTitleEdit = (node: WorkflowCanvasNode) => {
    if (!onUpdateNode || !isWorkflowNodeType(node.type)) return;
    onSelectNode(node.nodeKey);
    setEditingTitle(node.nodeKey);
    setTitleDraft(resolveWorkflowNodeTitle(node.type, node.title, locale));
  };
  const commitTitleEdit = (node: WorkflowCanvasNode) => {
    if (onUpdateNode && isWorkflowNodeType(node.type)) {
      onUpdateNode(node.nodeKey, {
        title: titleDraft.trim() || resolveWorkflowNodeTitle(node.type, node.title, locale),
      });
    }
    setEditingTitle(null);
    setTitleDraft("");
  };

  const sceneBounds = useMemo(
    () => calculateWorkflowCanvasSceneBounds(renderedNodes, viewport, viewportSize),
    [renderedNodes, viewport, viewportSize],
  );
  const minimap = useMemo(() => {
    const minX = Math.min(0, ...renderedNodes.map((node) => node.positionX)) - 72;
    const minY = Math.min(0, ...renderedNodes.map((node) => node.positionY)) - 72;
    const maxX = Math.max(960, ...renderedNodes.map((node) => node.positionX + NODE_WIDTH)) + 72;
    const maxY = Math.max(640, ...renderedNodes.map((node) => node.positionY + NODE_SELECTION_HEIGHT)) + 72;
    const width = maxX - minX;
    const height = maxY - minY;
    const scale = Math.min(160 / width, 104 / height);
    return { minX, minY, width, height, scale };
  }, [renderedNodes]);
  const minimapViewport = {
    left: ((-viewport.x / viewport.scale) - minimap.minX) * minimap.scale,
    top: ((-viewport.y / viewport.scale) - minimap.minY) * minimap.scale,
    width: Math.max(14, (viewportSize.width / viewport.scale) * minimap.scale),
    height: Math.max(14, (viewportSize.height / viewport.scale) * minimap.scale),
  };
  const moveViewportFromMinimap = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const worldX = minimap.minX + ((event.clientX - bounds.left) / minimap.scale);
    const worldY = minimap.minY + ((event.clientY - bounds.top) / minimap.scale);
    const next = {
      ...viewportRef.current,
      x: viewportSize.width / 2 - worldX * viewportRef.current.scale,
      y: viewportSize.height / 2 - worldY * viewportRef.current.scale,
    };
    viewportRef.current = next;
    setViewport(next);
  };

  return (
    <Canvas className="ai-elements-workflow-canvas"><section className={`shared-workflow-canvas ${className ?? ""}`} data-ai-element="canvas">
      <div
        ref={rootRef}
        className={`shared-workflow-canvas-viewport ${dragging ? "is-dragging" : ""} ${paletteDrag ? "is-palette-dragging" : ""}`}
        onPointerDown={startPan}
      >
        <div className="shared-workflow-canvas-grid" style={{ backgroundPosition: `${viewport.x}px ${viewport.y}px`, backgroundSize: `${22 * viewport.scale}px ${22 * viewport.scale}px` }} />
        <Controls className="shared-workflow-canvas-tools" aria-label={locale === "zh" ? "画布控制" : "Canvas controls"}>
          <Toolbar className="ai-elements-workflow-toolbar">
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label={locale === "zh" ? "撤销" : "Undo"}><Undo2 size={14} /></button>
          <button type="button" onClick={onRedo} disabled={!canRedo} aria-label={locale === "zh" ? "重做" : "Redo"}><Redo2 size={14} /></button>
          <button type="button" onClick={copySelectedNodes} disabled={!copyableSelectedNodeKeys.length} aria-label={locale === "zh" ? "复制选中节点" : "Copy selected nodes"}><Copy size={14} /></button>
          <button type="button" onClick={pasteSelectedNodes} disabled={!clipboardNodeKeys.length || !onDuplicateNodes} aria-label={locale === "zh" ? "粘贴节点" : "Paste nodes"}><ClipboardPaste size={14} /></button>
          <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clampScale(current.scale - ZOOM_STEP) }))} aria-label={locale === "zh" ? "缩小" : "Zoom out"}><Minus size={14} /></button>
          <button type="button" onClick={() => setViewport((current) => ({ ...current, scale: clampScale(current.scale + ZOOM_STEP) }))} aria-label={locale === "zh" ? "放大" : "Zoom in"}><Plus size={14} /></button>
          <button type="button" onClick={() => setViewport({ ...initialViewport })} aria-label={locale === "zh" ? "重置视图" : "Reset view"}><RotateCcw size={14} /></button>
          </Toolbar>
        </Controls>
        <div
          className="shared-workflow-canvas-scene"
          style={{ width: sceneBounds.width, height: sceneBounds.height, transform: `translate(${viewport.x + sceneBounds.minX * viewport.scale}px, ${viewport.y + sceneBounds.minY * viewport.scale}px) scale(${viewport.scale})` }}
        >
          <svg className="shared-workflow-canvas-edges" width={sceneBounds.width} height={sceneBounds.height} aria-hidden="true">
            <g transform={`translate(${-sceneBounds.minX} ${-sceneBounds.minY})`}>
            {edges.map((edge) => {
              const source = renderedNodeMap.get(edge.sourceNodeKey);
              const target = renderedNodeMap.get(edge.targetNodeKey);
              const connection = source && target ? resolvePorts(source, target, edge.sourcePortId, edge.targetPortId) : null;
              if (!source || !target || !connection) return null;
              const start = getOutputPortCenter(source);
              const end = getInputPortCenter(target);
              const selected = selectedEdge?.edge.edgeKey === edge.edgeKey;
              const path = buildPath(start.x, start.y, end.x, end.y);
              return (
                <Edge as="g" key={edge.edgeKey}>
                  <path
                    d={path}
                    className="shared-workflow-edge-hit"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedEdge({ edge, sourcePortId: connection.sourcePort.id, targetPortId: connection.targetPort.id });
                      onSelectNode(null);
                    }}
                  />
                  <path d={path} className={selected ? "shared-workflow-edge selected" : "shared-workflow-edge"} />
                </Edge>
              );
            })}
            {connectionDrag ? (
              <path
                d={buildPath(
                  connectionDrag.startX,
                  connectionDrag.startY,
                  hoveredTarget
                    ? getInputPortCenter(renderedNodeMap.get(hoveredTarget.targetNodeKey)!).x
                    : connectionDrag.currentX,
                  hoveredTarget
                    ? getInputPortCenter(renderedNodeMap.get(hoveredTarget.targetNodeKey)!).y
                    : connectionDrag.currentY,
                )}
                className="shared-workflow-edge active"
              />
            ) : null}
            </g>
          </svg>
          {selectedEdge && renderedNodeMap.has(selectedEdge.edge.sourceNodeKey) && renderedNodeMap.has(selectedEdge.edge.targetNodeKey) ? (
            <button
              type="button"
              className="shared-workflow-edge-delete"
              style={{
                left:
                  (getOutputPortCenter(renderedNodeMap.get(selectedEdge.edge.sourceNodeKey)!).x +
                    getInputPortCenter(renderedNodeMap.get(selectedEdge.edge.targetNodeKey)!).x) /
                  2 - sceneBounds.minX,
                top:
                  (getOutputPortCenter(renderedNodeMap.get(selectedEdge.edge.sourceNodeKey)!).y +
                    getInputPortCenter(renderedNodeMap.get(selectedEdge.edge.targetNodeKey)!).y) /
                  2 - sceneBounds.minY,
              }}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteEdge?.(selectedEdge.edge);
                setSelectedEdge(null);
              }}
              aria-label={locale === "zh" ? "删除连线" : "Delete connection"}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
          {selectionBox ? <div className="shared-workflow-selection-box" style={{ left: boundsForSelection(selectionBox).left - sceneBounds.minX, top: boundsForSelection(selectionBox).top - sceneBounds.minY, width: boundsForSelection(selectionBox).right - boundsForSelection(selectionBox).left, height: boundsForSelection(selectionBox).bottom - boundsForSelection(selectionBox).top }} /> : null}
          {renderedNodes.map((node) => {
            const definition = getDefinition(node);
            const execution = executionMap.get(node.nodeKey);
            const tone = statusTone(execution?.status);
            const selected = selectedNodeKeys.includes(node.nodeKey);
            const isSource = pendingConnectionSourceKey === node.nodeKey;
            const titleEditing = editingTitle === node.nodeKey;
            const inputPorts = definition?.inputs ?? [];
            const outputPorts = definition?.outputs ?? [];
            const mediaSlots = inputPorts.filter((port) => port.role && port.role !== "text.prompt");
            const mediaSlotCounts = new Map(mediaSlots.map((port) => [port.id, edges.filter((edge) => edge.targetNodeKey === node.nodeKey && edge.targetPortId === port.id).length]));
            const mediaReferences = mediaSlots.flatMap((port) => edges
              .filter((edge) => edge.targetNodeKey === node.nodeKey && edge.targetPortId === port.id)
              .map((edge, index) => ({
                edge,
                port,
                index,
                source: renderedNodeMap.get(edge.sourceNodeKey) ?? nodeMap.get(edge.sourceNodeKey),
              })));
            const hasPreviewableMedia = nodeHasPreviewableMedia(node);
            const mediaInteractionEnabled = mediaInteractionNodeKey === node.nodeKey;
            // Only the default input is structural. Result preview nodes are
            // regular graph nodes so a workflow can expose multiple outputs.
            const fixedNode = node.nodeKey === "input";
            const parameterEntries = (definition?.configSchema ?? [])
              .filter((field) => field.rendererId !== "asset" && field.rendererId !== "agent" && field.rendererId !== "dataset" && field.rendererId !== "custom")
              .map((field) => {
                const value = node.config[field.id] ?? field.defaultValue;
                return [field.label[locale] ?? field.id, value === undefined || value === null || value === "" ? (locale === "zh" ? "未设置" : "Not set") : value] as const;
              })
              .filter(([, value]) => typeof value !== "object")
              .slice(0, 3);
            const nodeEditor = renderNodeEditor?.(node);
            return (
              <Node
                bare
                key={node.nodeKey}
                className={`shared-workflow-node ${selected ? "selected" : ""} ${isSource ? "connection-source" : ""} ${mediaInteractionEnabled ? "media-interaction-active" : ""}`}
                style={{ left: node.positionX - sceneBounds.minX, top: node.positionY - sceneBounds.minY, borderColor: selected || execution ? tone[0] : undefined }}
                onPointerDown={(event) => startNodeDrag(event, node)}
                data-agent-node={node.nodeKey}
              >
                <div className="shared-workflow-node-port-list">
                  {inputPorts.length ? <span className="shared-workflow-port input aggregate" title={locale === "zh" ? "聚合输入端点" : "Combined input"} /> : null}
                  {outputPorts.length ? <button type="button" data-node-no-drag="true" className="shared-workflow-port output aggregate" title={locale === "zh" ? "聚合输出端点" : "Combined output"} onPointerDown={(event) => startConnectionDrag(event, node)} aria-label={locale === "zh" ? "从节点输出端点连线" : "Connect from node output"} /> : null}
                </div>
                <header className="shared-workflow-node-header">
                  <div className="shared-workflow-node-title-wrap">
                    {titleEditing ? (
                      <input
                        autoFocus
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={() => commitTitleEdit(node)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitTitleEdit(node);
                          if (event.key === "Escape") {
                            setEditingTitle(null);
                            setTitleDraft("");
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <strong onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); beginTitleEdit(node); }}>
                        {isWorkflowNodeType(node.type) ? resolveWorkflowNodeTitle(node.type, node.title, locale) : node.title}
                      </strong>
                    )}
                    <small>{node.nodeKey}</small>
                  </div>
                  <div className="shared-workflow-node-actions">
                    {hasPreviewableMedia ? <button type="button" data-node-no-drag="true" onClick={(event) => { event.stopPropagation(); setMediaInteractionNodeKey((current) => current === node.nodeKey ? null : node.nodeKey); }} aria-pressed={mediaInteractionEnabled} aria-label={mediaInteractionEnabled ? (locale === "zh" ? "切换为移动节点" : "Switch to move node") : (locale === "zh" ? "操作媒体内容" : "Interact with media")}><span className="sr-only">{mediaInteractionEnabled ? (locale === "zh" ? "移动节点" : "Move node") : (locale === "zh" ? "操作媒体" : "Interact")}</span>{mediaInteractionEnabled ? <MousePointer2 size={13} /> : <Move size={13} />}</button> : null}
                    <button type="button" data-node-no-drag="true" onClick={(event) => { event.stopPropagation(); if (isSource) onCancelConnection?.(); else onStartConnection?.(node.nodeKey); }} aria-label={isSource ? (locale === "zh" ? "取消连线" : "Cancel connection") : (locale === "zh" ? "开始连线" : "Start connection")}><Link2 size={13} /></button>
                    {!fixedNode && onDuplicateNode ? <button type="button" data-node-no-drag="true" onClick={(event) => { event.stopPropagation(); onDuplicateNode(node.nodeKey); }} aria-label={locale === "zh" ? "复制节点" : "Duplicate node"}><Copy size={13} /></button> : null}
                    {!fixedNode && onDeleteNode ? <button type="button" data-node-no-drag="true" onClick={(event) => { event.stopPropagation(); onDeleteNode(node.nodeKey); }} aria-label={locale === "zh" ? "删除节点" : "Delete node"}><Trash2 size={13} /></button> : null}
                  </div>
                  {execution ? <span className="shared-workflow-status" style={{ background: tone[1], color: tone[2] }}><i style={{ background: tone[2] }} /><span>{statusLabel(locale, execution.status)}</span></span> : null}
                </header>
                {(inputPorts.length || outputPorts.length) ? <div className="shared-workflow-node-port-summary" title={`${inputPorts.map((port) => port.id).join(", ")} → ${outputPorts.map((port) => port.id).join(", ")}`}><span>{inputPorts.length ? `${locale === "zh" ? "输入" : "In"} ${inputPorts.map((port) => port.valueKind).join(" · ")}` : locale === "zh" ? "无输入" : "No input"}</span><span>{outputPorts.length ? `${locale === "zh" ? "输出" : "Out"} ${outputPorts.map((port) => port.valueKind).join(" · ")}` : locale === "zh" ? "无输出" : "No output"}</span></div> : null}
                <div className="shared-workflow-node-body">
                  {mediaSlots.length ? <div className="shared-workflow-media-slots" data-node-media-slots="true">{mediaSlots.map((port) => <span key={port.id} className={isConnectionSlotEnabled(node, port.id) ? "" : "unsupported"} title={isConnectionSlotEnabled(node, port.id) ? undefined : (locale === "zh" ? "当前 Provider 不支持该输入" : "The current Provider does not support this input")}>{mediaPortLabel(port, locale)}{mediaSlotCounts.get(port.id) ? ` ${mediaSlotCounts.get(port.id)}` : ""}</span>)}</div> : null}
                  {mediaReferences.length ? <div className="shared-workflow-media-references" aria-label={locale === "zh" ? "已连接媒体引用" : "Connected media references"}>{mediaReferences.map(({ edge, port, index, source }) => <div key={edge.edgeKey} className="shared-workflow-media-reference"><span>{mediaPortLabel(port, locale)} {index + 1}</span><strong title={source?.title ?? edge.sourceNodeKey}>{source ? (isWorkflowNodeType(source.type) ? resolveWorkflowNodeTitle(source.type, source.title, locale) : source.title) : edge.sourceNodeKey}</strong>{onDeleteEdge ? <button type="button" data-node-no-drag="true" title={locale === "zh" ? "移除此引用" : "Remove this reference"} aria-label={locale === "zh" ? "移除此引用" : "Remove this reference"} onClick={(event) => { event.stopPropagation(); onDeleteEdge(edge); }}><Trash2 size={12} /></button> : null}</div>)}</div> : null}
                  {parameterEntries.length && !nodeEditor ? <div className="shared-workflow-params" data-node-parameters="true">{parameterEntries.map(([key, value]) => <span key={key} title={`${key}: ${formatParameterValue(value)}`}>{key}: {formatParameterValue(value).slice(0, 26)}</span>)}</div> : null}
                  {nodeEditor ?? (!parameterEntries.length ? <small className="shared-workflow-empty-params">{locale === "zh" ? "无参数" : "No parameters"}</small> : null)}
                  {execution && renderNodeOutput ? renderNodeOutput(node, execution) : null}
                </div>
                {!providerConfiguredForNode(node.type) && requiresProviderForNode(node.type) ? <div className="shared-workflow-provider-warning">{locale === "zh" ? "需要配置 Provider" : "Configuration required"}</div> : null}
                <footer className="shared-workflow-node-footer">{isWorkflowNodeType(node.type) ? getWorkflowNodeOutputKinds(node.type).map((kind) => <i key={kind} title={kind} />) : null}</footer>
              </Node>
            );
          })}
          {pendingPortChoice ? <Connection className="shared-workflow-port-choice" style={{ left: pendingPortChoice.x - sceneBounds.minX + 14, top: pendingPortChoice.y - sceneBounds.minY - 18 }} role="dialog" aria-label={locale === "zh" ? "选择连接端口" : "Choose connection port"}>
            <strong>{locale === "zh" ? "选择连接槽位" : "Choose connection slot"}</strong>
            {pendingPortChoice.candidates.map((candidate) => {
              const source = renderedNodeMap.get(pendingPortChoice.sourceNodeKey);
              const target = renderedNodeMap.get(pendingPortChoice.targetNodeKey);
              const sourcePort = source ? getDefinition(source)?.outputs.find((port) => port.id === candidate.sourcePortId) : undefined;
              const targetPort = target ? getDefinition(target)?.inputs.find((port) => port.id === candidate.targetPortId) : undefined;
              return <button key={`${candidate.sourcePortId}-${candidate.targetPortId}`} type="button" onClick={() => { onConnect?.(pendingPortChoice.sourceNodeKey, pendingPortChoice.targetNodeKey, candidate.sourcePortId, candidate.targetPortId); onCancelConnection?.(); setPendingPortChoice(null); }}><span>{mediaPortLabel(sourcePort, locale)}</span><span>→</span><span>{mediaPortLabel(targetPort, locale)}</span></button>;
            })}
            <button type="button" className="shared-workflow-port-choice-cancel" onClick={() => { onCancelConnection?.(); setPendingPortChoice(null); }}>{locale === "zh" ? "取消" : "Cancel"}</button>
          </Connection> : null}
          {!nodes.length ? <div className="shared-workflow-empty"><strong>{locale === "zh" ? "空白画布" : "Empty canvas"}</strong><span>{locale === "zh" ? "从节点库添加第一个节点" : "Add the first node from the library"}</span></div> : null}
        </div>
        <Panel position="bottom-right" className="shared-workflow-canvas-minimap" onPointerDown={moveViewportFromMinimap} aria-label={locale === "zh" ? "工作流小地图" : "Workflow minimap"} title={locale === "zh" ? "点击定位画布" : "Click to reposition canvas"}>
          <div className="shared-workflow-canvas-minimap-viewport" style={minimapViewport} />
          {renderedNodes.map((node) => <i key={node.nodeKey} className={selectedNodeKeys.includes(node.nodeKey) ? "selected" : ""} style={{ left: (node.positionX - minimap.minX) * minimap.scale, top: (node.positionY - minimap.minY) * minimap.scale, width: Math.max(9, NODE_WIDTH * minimap.scale), height: Math.max(6, NODE_SELECTION_HEIGHT * minimap.scale) }} />)}
        </Panel>
      </div>
    </section></Canvas>
  );
}
