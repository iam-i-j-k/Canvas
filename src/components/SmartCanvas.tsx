"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  MousePointer2,
  Pencil,
  HighlighterIcon,
  Eraser,
  Minus,
  Square,
  Circle,
  Type,
  Eye,
  EyeOff,
  Trash2,
  Undo2,
  Redo2,
  UploadCloud,
  Download,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Save,
  FileUp,
  Maximize2,
  Minimize2,
} from "lucide-react"

// --- Types & Constants ---
const TOOLS = {
  PEN: "pen",
  HIGHLIGHTER: "highlighter",
  ERASER: "eraser",
  LINE: "line",
  RECT: "rect",
  ELLIPSE: "ellipse",
  TEXT: "text",
  SELECT: "select",
} as const

const BACKGROUNDS = {
  PLAIN: "plain",
  GRID: "grid",
  RULED: "ruled",
  DOT: "dot",
} as const

const BRUSH_TYPES = {
  SMOOTH: "smooth",
  TEXTURED: "textured",
  CALLIGRAPHY: "calligraphy",
} as const

type Tool = (typeof TOOLS)[keyof typeof TOOLS]

interface Point {
  x: number
  y: number
  p?: number // pressure 0..1
}

type StrokeOp = {
  kind: "stroke"
  tool: Tool
  color: string
  size: number
  alpha: number
  composite: GlobalCompositeOperation
  points: Point[]
  smooth: boolean
  brushType: string
  layer: number
}

type ShapeOp = {
  kind: "shape"
  shape: "line" | "rect" | "ellipse"
  color: string
  size: number
  alpha: number
  composite: GlobalCompositeOperation
  x0: number
  y0: number
  x1: number
  y1: number
  layer: number
}

type TextOp = {
  kind: "text"
  text: string
  x: number
  y: number
  color: string
  size: number
  font: string
  layer: number
}

type ImageOp = {
  kind: "image"
  // We serialize images by src for JSON, but at runtime we keep actual element
  img: HTMLImageElement
  x: number
  y: number
  w: number
  h: number
  layer: number
}

type Op = StrokeOp | ShapeOp | ImageOp | TextOp

interface Layer {
  id: number
  name: string
  visible: boolean
  opacity: number
}

// --- Utils ---
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

// Ramer–Douglas–Peucker simplification
function simplifyRDP(points: Point[], epsilon = 0.8): Point[] {
  if (points.length < 3) return points
  const sq = (n: number) => n * n
  function distSqToSegment(p: Point, a: Point, b: Point) {
    const vx = b.x - a.x,
      vy = b.y - a.y
    const wx = p.x - a.x,
      wy = p.y - a.y
    const c1 = vx * wx + vy * wy
    if (c1 <= 0) return sq(p.x - a.x) + sq(p.y - a.y)
    const c2 = vx * vx + vy * vy
    if (c2 <= c1) return sq(p.x - b.x) + sq(p.y - b.y)
    const t = c1 / c2
    const px = a.x + t * vx,
      py = a.y + t * vy
    return sq(p.x - px) + sq(p.y - py)
  }
  function rdp(pts: Point[], epsSq: number): Point[] {
    let dmax = 0,
      idx = 0
    const end = pts.length - 1
    for (let i = 1; i < end; i++) {
      const d = distSqToSegment(pts[i], pts[0], pts[end])
      if (d > dmax) {
        idx = i
        dmax = d
      }
    }
    if (dmax > epsSq) {
      const rec1 = rdp(pts.slice(0, idx + 1), epsSq)
      const rec2 = rdp(pts.slice(idx, end + 1), epsSq)
      return rec1.slice(0, -1).concat(rec2)
    }
    return [pts[0], pts[end]]
  }
  return rdp(points, epsilon * epsilon)
}

function drawSmoothStroke(ctx: CanvasRenderingContext2D, pts: Point[], brushType: string) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (brushType === "calligraphy") {
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2
      const midY = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
    }
  } else if (brushType === "textured") {
    for (let i = 1; i < pts.length - 1; i++) {
      const noise = (Math.random() - 0.5) * 2
      const midX = (pts[i].x + pts[i + 1].x) / 2 + noise
      const midY = (pts[i].y + pts[i + 1].y) / 2 + noise
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
    }
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2
      const midY = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
    }
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  ctx.stroke()
}

function constrainWithShift(shape: ShapeOp, shift: boolean): ShapeOp {
  if (!shift) return shape
  const { x0, y0, x1, y1 } = shape
  if (shape.shape === "line") {
    const dx = x1 - x0,
      dy = y1 - y0
    const angle = Math.atan2(dy, dx)
    const snaps = [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
      -Math.PI / 4,
      -Math.PI / 2,
      (-3 * Math.PI) / 4,
    ]
    let best = snaps[0],
      min = Number.POSITIVE_INFINITY
    for (const a of snaps) {
      const d = Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a)))
      if (d < min) {
        min = d
        best = a
      }
    }
    const len = Math.hypot(dx, dy)
    return { ...shape, x1: x0 + len * Math.cos(best), y1: y0 + len * Math.sin(best) }
  }
  const w = x1 - x0,
    h = y1 - y0
  const sideX = Math.sign(w) * Math.min(Math.abs(w), Math.abs(h))
  const sideY = Math.sign(h) * Math.min(Math.abs(w), Math.abs(h))
  return { ...shape, x1: x0 + sideX, y1: y0 + sideY }
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  ctx.save()
  // Base fill (solid white so exports look consistent)
  ctx.globalCompositeOperation = "source-over"
  ctx.globalAlpha = 1
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, w, h)

  if (bg === "grid") {
    ctx.lineWidth = 1
    ctx.strokeStyle = "#e5e7eb"
    const gap = 32
    ctx.beginPath()
    for (let x = 0.5; x <= w; x += gap) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    for (let y = 0.5; y <= h; y += gap) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
  } else if (bg === "ruled") {
    ctx.lineWidth = 1
    ctx.strokeStyle = "#c7d2fe"
    const gap = 36
    ctx.beginPath()
    for (let y = gap + 0.5; y <= h; y += gap) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.strokeStyle = "#fecaca"
    ctx.beginPath()
    ctx.moveTo(64.5, 0)
    ctx.lineTo(64.5, h)
    ctx.stroke()
  } else if (bg === "dot") {
    ctx.fillStyle = "#e5e7eb"
    const gap = 24
    for (let x = gap; x < w; x += gap) {
      for (let y = gap; y < h; y += gap) {
        ctx.beginPath()
        ctx.arc(x, y, 1, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

function useResizeObserver(ref: React.RefObject<Element | null>, cb: () => void) {
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(() => cb())
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref, cb])
}

// --- Small UI components ---
function IconButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; title?: string; icon: React.ReactNode },
) {
  const { active, icon, className = "", ...rest } = props
  return (
    <button
      type="button"
      aria-pressed={!!active}
      data-state={active ? "on" : "off"}
      {...rest}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm transition-colors
      ${active ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary" : "bg-card text-card-foreground border-border hover:bg-accent hover:text-accent-foreground"}
      ${className}`}
    >
      {icon}
    </button>
  )
}

function LabeledSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (n: number) => void
  suffix?: string
}) {
  const display =
    suffix === "%" ? `${Math.round(value * 100)}%` : suffix ? `${Math.round(value)}${suffix}` : `${Math.round(value)}`
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          aria-label={label}
        />
        <span className="text-sm w-14 text-center">{display}</span>
      </div>
    </div>
  )
}

function ColorSwatch({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const presets = useMemo(
    () => [
      "#111827",
      "#1f2937",
      "#374151",
      "#0ea5a4",
      "#2563eb",
      "#10b981",
      "#ef4444",
      "#f59e0b",
      "#e11d48",
      "#7c3aed",
    ],
    [],
  )
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Color picker"
        className="h-8 w-10 rounded-md border border-border bg-input"
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="h-6 w-6 rounded-md border border-border"
            style={{ backgroundColor: c }}
            aria-label={`Set color ${c}`}
            title={c}
          />
        ))}
      </div>
    </div>
  )
}

// --- Main Component ---
export default function SmartCanvas() {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)

  const [ops, setOps] = useState<Op[]>([])
  const [redo, setRedo] = useState<Op[]>([])
  const [layers, setLayers] = useState<Layer[]>([{ id: 0, name: "Layer 1", visible: true, opacity: 1 }])
  const [currentLayer, setCurrentLayer] = useState<number>(0)

  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState("#164e63")
  const [size, setSize] = useState(4)
  const [alpha, setAlpha] = useState(1)
  const [smooth, setSmooth] = useState(true)
  const [brushType, setBrushType] = useState<string>("smooth")
  const [shapeAssist, setShapeAssist] = useState(true)
  const [background, setBackground] = useState<string>("plain")

  const [isDrawing, setIsDrawing] = useState(false)
  const [currentStroke, setCurrentStroke] = useState<StrokeOp | null>(null)
  const [currentShape, setCurrentShape] = useState<ShapeOp | null>(null)
  const [shiftKey, setShiftKey] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // floating text editor
  const [textEditor, setTextEditor] = useState<{ visible: boolean; x: number; y: number; value: string }>({
    visible: false,
    x: 0,
    y: 0,
    value: "",
  })

  // DPR
  const [dpr, setDpr] = useState(1)
  useEffect(() => {
    const update = () => setDpr(Math.max(1, Math.min(3, window.devicePixelRatio || 1)))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  // Resize canvas to container
  const resizeCanvas = () => {
    const c = canvasRef.current
    const p = previewRef.current
    const w = wrapRef.current
    if (!c || !p || !w) return
    const rect = w.getBoundingClientRect()
    const W = Math.max(1, Math.floor(rect.width))
    const H = Math.max(1, Math.floor(rect.height))
    for (const cv of [c, p]) {
      cv.width = Math.floor(W * dpr)
      cv.height = Math.floor(H * dpr)
      cv.style.width = `${W}px`
      cv.style.height = `${H}px`
      const ctx = cv.getContext("2d")
      if (ctx) {
        // work in device pixels (identity transform)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, cv.width, cv.height)
      }
    }
    renderAll()
  }

  useResizeObserver(wrapRef, resizeCanvas)
  useEffect(() => {
    resizeCanvas()
  }, [dpr])

  // Keyboard helpers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault()
        handleRedo()
      } else if (e.key === "Shift") setShiftKey(true)
      // quick tool shortcuts
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === "v") setTool("select")
        if (key === "p") setTool("pen")
        if (key === "h") setTool("highlighter")
        if (key === "e") setTool("eraser")
        if (key === "l") setTool("line")
        if (key === "r") setTool("rect")
        if (key === "o") setTool("ellipse")
        if (key === "t") setTool("text")
        if (key === "f") {
          e.preventDefault()
          toggleFullscreen()
        }
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftKey(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onUp)
    }
  }, [])

  // Fullscreen helpers
  const getToolLabel = (t: Tool) => {
    switch (t) {
      case "select":
        return "Select"
      case "pen":
        return "Pen"
      case "highlighter":
        return "Highlighter"
      case "eraser":
        return "Eraser"
      case "line":
        return "Line"
      case "rect":
        return "Rectangle"
      case "ellipse":
        return "Ellipse"
      case "text":
        return "Text"
      default:
        return "Unknown"
    }
  }

  const toggleFullscreen = async () => {
    const el = wrapRef.current
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (err) {
      // optional: surface error to user or console
      // console.error("[v0] Fullscreen error:", err)
    }
  }

  useEffect(() => {
    const onFsChange = () => {
      const el = wrapRef.current
      const fs = !!document.fullscreenElement && el === document.fullscreenElement
      setIsFullscreen(fs)
      // ensure canvases are resized to the new dimensions
      resizeCanvas()
    }
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  // Rendering
  function renderAll() {
    const c = canvasRef.current
    const ctx = c?.getContext("2d")
    if (!c || !ctx) return
    const w = c.width
    const h = c.height

    // background (device pixels)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    paintBackground(ctx, w, h, background)
    ctx.restore()

    // render ops by layer
    for (const layer of layers) {
      if (!layer.visible) continue
      ctx.globalAlpha = layer.opacity
      const layerOps = ops.filter((op) => op.layer === layer.id)
      for (const op of layerOps) {
        if (op.kind === "image") {
          ctx.globalCompositeOperation = "source-over"
          ctx.globalAlpha = layer.opacity
          ctx.drawImage(op.img, op.x, op.y, op.w, op.h)
          continue
        }
        if (op.kind === "text") {
          ctx.globalCompositeOperation = "source-over"
          ctx.globalAlpha = layer.opacity
          ctx.fillStyle = op.color
          ctx.font = `${op.size}px ${op.font}`
          ctx.fillText(op.text, op.x, op.y)
          continue
        }
        ctx.globalCompositeOperation = op.composite
        ctx.globalAlpha = op.alpha * layer.opacity
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        if (op.kind === "stroke") {
          const base = op.size
          ctx.strokeStyle = op.color
          const pts = op.points
          if (!pts.length) continue
          if (op.smooth) {
            ctx.beginPath()
            let prev = pts[0]
            ctx.moveTo(prev.x, prev.y)
            for (let i = 1; i < pts.length; i++) {
              const p = pts[i]
              const midX = (prev.x + p.x) / 2
              const midY = (prev.y + p.y) / 2
              ctx.lineWidth = base * (op.tool === "eraser" ? 1 : 0.5 + 0.5 * (p.p ?? 0.8))
              ctx.quadraticCurveTo(prev.x, prev.y, midX, midY)
              prev = p
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
            ctx.stroke()
          } else {
            ctx.lineWidth = base
            drawSmoothStroke(ctx, pts, op.brushType)
          }
        } else if (op.kind === "shape") {
          ctx.strokeStyle = op.color
          ctx.lineWidth = op.size
          const x = Math.min(op.x0, op.x1)
          const y = Math.min(op.y0, op.y1)
          const w2 = Math.abs(op.x1 - op.x0)
          const h2 = Math.abs(op.y1 - op.y0)
          if (op.shape === "line") {
            ctx.beginPath()
            ctx.moveTo(op.x0, op.y0)
            ctx.lineTo(op.x1, op.y1)
            ctx.stroke()
          } else if (op.shape === "rect") {
            ctx.strokeRect(x, y, w2, h2)
          } else if (op.shape === "ellipse") {
            ctx.beginPath()
            ctx.ellipse(x + w2 / 2, y + h2 / 2, w2 / 2, h2 / 2, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
    }

    // clear preview
    const pv = previewRef.current
    const pctx = pv?.getContext("2d")
    if (pctx && pv) {
      pctx.clearRect(0, 0, pv.width, pv.height)
    }
  }

  useEffect(() => {
    renderAll()
  }, [ops, background, layers])

  // Pointer helpers: we store device-pixel coordinates
  function getPos(e: React.PointerEvent): Point {
    const c = canvasRef.current
    if (!c) return { x: 0, y: 0, p: 0.5 }
    const rect = c.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (c.width / rect.width)
    const y = (e.clientY - rect.top) * (c.height / rect.height)
    const p = clamp(e.pressure || 0.5, 0.05, 1)
    return { x, y, p }
  }

  const FREEHAND_TOOLS: Tool[] = ["pen", "highlighter", "eraser"]

  function pointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setRedo([])
    const pos = getPos(e)

    // Text tool: open editor at position
    if (tool === "text") {
      setTextEditor({ visible: true, x: pos.x, y: pos.y, value: "" })
      return
    }

    setIsDrawing(true)
    if (FREEHAND_TOOLS.includes(tool)) {
      const stroke: StrokeOp = {
        kind: "stroke",
        tool,
        color: tool === "eraser" ? "#000000" : color,
        size,
        alpha: tool === "highlighter" ? 0.3 : alpha,
        composite: tool === "eraser" ? "destination-out" : "source-over",
        points: [pos],
        smooth,
        brushType,
        layer: currentLayer,
      }
      setCurrentStroke(stroke)
      setOps((prev) => prev.concat(stroke))
    } else if (tool !== "select") {
      const shapeName = tool === "line" ? "line" : tool === "rect" ? "rect" : "ellipse"
      const shape: ShapeOp = {
        kind: "shape",
        shape: shapeName as any,
        color,
        size,
        alpha,
        composite: "source-over",
        x0: pos.x,
        y0: pos.y,
        x1: pos.x,
        y1: pos.y,
        layer: currentLayer,
      }
      setCurrentShape(shape)
    }
  }

  function pointerMove(e: React.PointerEvent) {
    if (!isDrawing) return
    const pos = getPos(e)
    if (currentStroke) {
      setOps((prev) => {
        const next = prev.slice()
        const last = next[next.length - 1] as StrokeOp
        if (last && last.kind === "stroke") {
          last.points.push(pos)
        }
        return next
      })
    } else if (currentShape) {
      const pv = previewRef.current
      const pctx = pv?.getContext("2d")
      if (!pv || !pctx) return
      pctx.clearRect(0, 0, pv.width, pv.height)
      const base: ShapeOp = { ...currentShape, x1: pos.x, y1: pos.y }
      const sh = shapeAssist ? constrainWithShift(base, shiftKey) : base
      pctx.save()
      pctx.setTransform(1, 0, 0, 1, 0, 0)
      pctx.globalCompositeOperation = "source-over"
      pctx.globalAlpha = alpha
      pctx.lineWidth = size
      pctx.strokeStyle = color
      if (sh.shape === "line") {
        pctx.beginPath()
        pctx.moveTo(sh.x0, sh.y0)
        pctx.lineTo(sh.x1, sh.y1)
        pctx.stroke()
      } else if (sh.shape === "rect") {
        const x = Math.min(sh.x0, sh.x1),
          y = Math.min(sh.y0, sh.y1)
        const w = Math.abs(sh.x1 - sh.x0),
          h = Math.abs(sh.y1 - sh.y0)
        pctx.strokeRect(x, y, w, h)
      } else {
        const x = Math.min(sh.x0, sh.x1),
          y = Math.min(sh.y0, sh.y1)
        const w = Math.abs(sh.x1 - sh.x0),
          h = Math.abs(sh.y1 - sh.y0)
        pctx.beginPath()
        pctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        pctx.stroke()
      }
      pctx.restore()
    }
  }

  function pointerUp() {
    setIsDrawing(false)
    if (currentStroke) {
      const stroke = currentStroke
      setCurrentStroke(null)
      if (stroke.smooth) {
        const simplified = simplifyRDP(stroke.points, 0.9)
        setOps((prev) => {
          const next = prev.slice()
          const last = next[next.length - 1] as StrokeOp
          if (last && last === stroke) last.points = simplified
          return next
        })
      }
      renderAll()
    } else if (currentShape) {
      const base: ShapeOp = { ...currentShape }
      const sh = shapeAssist ? constrainWithShift(base, shiftKey) : base
      setOps((prev) => prev.concat(sh))
      setCurrentShape(null)
      const pv = previewRef.current
      const pctx = pv?.getContext("2d")
      if (pctx && pv) pctx.clearRect(0, 0, pv.width, pv.height)
    }
  }

  // Text editor commit/cancel
  function commitText(value: string) {
    if (!value.trim()) {
      setTextEditor((t) => ({ ...t, visible: false, value: "" }))
      return
    }
    const op: TextOp = {
      kind: "text",
      text: value,
      x: textEditor.x,
      y: textEditor.y,
      color,
      size: Math.max(12, size * 6),
      font: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      layer: currentLayer,
    }
    setOps((prev) => prev.concat(op))
    setTextEditor({ visible: false, x: 0, y: 0, value: "" })
  }

  // Undo/Redo/Clear
  function handleUndo() {
    setOps((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice(0, prev.length - 1)
      setRedo((r) => [prev[prev.length - 1], ...r])
      return next
    })
  }
  function handleRedo() {
    setRedo((prev) => {
      if (prev.length === 0) return prev
      const [first, ...rest] = prev
      setOps((ops) => ops.concat(first))
      return rest
    })
  }
  function handleClear() {
    if (!confirm("Clear the canvas? This cannot be undone.")) return
    setOps([])
    setRedo([])
    renderAll()
  }

  // Export PNG
  function handleExportPNG() {
    const c = canvasRef.current
    if (!c) return
    const link = document.createElement("a")
    link.download = `smart-canvas-${Date.now()}.png`
    link.href = c.toDataURL("image/png")
    link.click()
  }

  // Save/Load JSON (excluding images for simplicity)
  function handleSaveJSON() {
    const serializable = ops.filter((op) => op.kind !== "image")
    const blob = new Blob([JSON.stringify(serializable)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `smart-canvas-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  function handleLoadJSON(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Op[]
        // basic validation
        if (!Array.isArray(parsed)) throw new Error("Invalid file")
        setOps(parsed)
        setRedo([])
      } catch (err) {
        alert("Invalid JSON file")
      }
    }
    reader.readAsText(file)
  }

  // Image import
  function handleImageImport(file: File) {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const c = canvasRef.current!
      const w = c.width
      const h = c.height
      const scale = Math.min(w / img.width, h / img.height, 1)
      const iw = img.width * scale
      const ih = img.height * scale
      const op: ImageOp = {
        kind: "image",
        img,
        x: (w - iw) / 2,
        y: (h - ih) / 2,
        w: iw,
        h: ih,
        layer: currentLayer,
      }
      setOps((prev) => prev.concat(op))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  // Layers
  function addLayer() {
    const newId = layers.length > 0 ? Math.max(...layers.map((l) => l.id)) + 1 : 0
    const name = `Layer ${layers.length + 1}`
    setLayers((prev) => [...prev, { id: newId, name, visible: true, opacity: 1 }])
    setCurrentLayer(newId)
  }
  function deleteLayer(id: number) {
    if (layers.length <= 1) return
    setLayers((prev) => prev.filter((l) => l.id !== id))
    setOps((prev) => prev.filter((op) => op.layer !== id))
    if (currentLayer === id) {
      const remaining = layers.filter((l) => l.id !== id)
      setCurrentLayer(remaining.length > 0 ? remaining[0].id : 0)
    }
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[540px] rounded-xl border border-border overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "w-80" : "w-12"} transition-all border-r border-border bg-card`}>
        <div className="h-12 flex items-center justify-between px-3 border-b border-border">
          <button
            className="inline-flex items-center gap-2 text-sm"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            {sidebarOpen && <span className="font-medium">Tools</span>}
          </button>
        </div>

        {sidebarOpen && (
          <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-3rem)]">
            {/* Tools */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tools</h3>
              <div className="grid grid-cols-4 gap-2">
                <IconButton
                  title="Select (V)"
                  icon={<MousePointer2 className="h-4 w-4" />}
                  active={tool === "select"}
                  onClick={() => setTool("select")}
                />
                <IconButton
                  title="Pen (P)"
                  icon={<Pencil className="h-4 w-4" />}
                  active={tool === "pen"}
                  onClick={() => setTool("pen")}
                />
                <IconButton
                  title="Highlighter (H)"
                  icon={<HighlighterIcon className="h-4 w-4" />}
                  active={tool === "highlighter"}
                  onClick={() => setTool("highlighter")}
                />
                <IconButton
                  title="Eraser (E)"
                  icon={<Eraser className="h-4 w-4" />}
                  active={tool === "eraser"}
                  onClick={() => setTool("eraser")}
                />
                <IconButton
                  title="Line (L)"
                  icon={<Minus className="h-4 w-4" />}
                  active={tool === "line"}
                  onClick={() => setTool("line")}
                />
                <IconButton
                  title="Rectangle (R)"
                  icon={<Square className="h-4 w-4" />}
                  active={tool === "rect"}
                  onClick={() => setTool("rect")}
                />
                <IconButton
                  title="Ellipse (O)"
                  icon={<Circle className="h-4 w-4" />}
                  active={tool === "ellipse"}
                  onClick={() => setTool("ellipse")}
                />
                <IconButton
                  title="Text (T)"
                  icon={<Type className="h-4 w-4" />}
                  active={tool === "text"}
                  onClick={() => setTool("text")}
                />
              </div>
            </div>

            {/* Style */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Style</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Color</label>
                  <ColorSwatch value={color} onChange={setColor} />
                </div>
                <LabeledSlider label="Brush Size" min={1} max={60} value={size} onChange={setSize} suffix="px" />
                <LabeledSlider
                  label="Opacity"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={alpha}
                  onChange={setAlpha}
                  suffix="%"
                />
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Brush Type</label>
                  <select
                    value={brushType}
                    onChange={(e) => setBrushType(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-input"
                  >
                    <option value="smooth">Smooth</option>
                    <option value="textured">Textured</option>
                    <option value="calligraphy">Calligraphy</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Layers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Layers</h3>
                <button
                  onClick={addLayer}
                  className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-border hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {layers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`flex items-center gap-2 p-2 rounded-md cursor-pointer border ${currentLayer === layer.id ? "bg-accent text-accent-foreground border-accent" : "hover:bg-muted border-transparent"}`}
                    onClick={() => setCurrentLayer(layer.id)}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, visible: !l.visible } : l)))
                      }}
                      className="p-1 rounded hover:bg-card/60"
                      title={layer.visible ? "Hide layer" : "Show layer"}
                      aria-label={layer.visible ? "Hide layer" : "Show layer"}
                    >
                      {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <span className="flex-1 text-sm truncate">{layer.name}</span>
                    {layers.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteLayer(layer.id)
                        }}
                        className="p-1 rounded hover:bg-destructive/10 text-destructive"
                        title="Delete layer"
                        aria-label="Delete layer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Background */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Background</h3>
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-input"
                aria-label="Background pattern"
              >
                <option value="plain">Plain</option>
                <option value="grid">Grid</option>
                <option value="ruled">Ruled</option>
                <option value="dot">Dot Grid</option>
              </select>
            </div>

            {/* Options */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Options</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smooth}
                  onChange={(e) => setSmooth(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm">Smooth Strokes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shapeAssist}
                  onChange={(e) => setShapeAssist(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm">Shape Assist (Shift)</span>
              </label>
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <section className="flex-1 flex flex-col min-w-0">
        {/* Top Toolbar */}
        <div className="bg-card border-b border-border px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="px-2 py-1 rounded-md border border-border hover:bg-accent hover:text-accent-foreground"
                  aria-label="Open sidebar"
                  title="Open sidebar"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleUndo}
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  disabled={ops.length === 0}
                  title="Undo (Ctrl/Cmd+Z)"
                >
                  <Undo2 className="h-4 w-4" /> Undo
                </button>
                <button
                  onClick={handleRedo}
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                  disabled={redo.length === 0}
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                >
                  <Redo2 className="h-4 w-4" /> Redo
                </button>
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  title="Clear canvas"
                >
                  <Trash2 className="h-4 w-4" /> Clear
                </button>
                {/* Current tool label */}
                <div
                  className="hidden md:flex items-center gap-2 ml-2"
                  aria-live="polite"
                  aria-atomic="true"
                  title="Current tool"
                >
                  <span className="text-xs text-muted-foreground">Tool:</span>
                  <span className="px-2 py-1 text-xs rounded-md border border-border bg-muted/30">
                    {getToolLabel(tool)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground cursor-pointer">
                <UploadCloud className="h-4 w-4" /> Import Image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleImageImport(f)
                    e.currentTarget.value = ""
                  }}
                />
              </label>

              <label className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground cursor-pointer">
                <FileUp className="h-4 w-4" /> Load JSON
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleLoadJSON(f)
                    e.currentTarget.value = ""
                  }}
                />
              </label>

              <button
                onClick={handleSaveJSON}
                className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground"
                title="Save as JSON (without images)"
              >
                <Save className="h-4 w-4" /> Save JSON
              </button>

              <button
                onClick={handleExportPNG}
                className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground"
                title="Export PNG"
              >
                <Download className="h-4 w-4" /> PNG
              </button>

              {/* Fullscreen toggle */}
              <button
                onClick={toggleFullscreen}
                aria-pressed={isFullscreen}
                className="inline-flex items-center gap-1 px-3 h-9 rounded-md border border-border hover:bg-accent hover:text-accent-foreground"
                title="Fullscreen (F)"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-4 w-4" /> Exit Fullscreen
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4" /> Fullscreen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div ref={wrapRef} className="relative flex-1 bg-background">
          <canvas ref={canvasRef} className="absolute inset-0" />
          <canvas
            ref={previewRef}
            className="absolute inset-0"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerLeave={pointerUp}
            onPointerCancel={pointerUp}
          />
          {/* Floating text editor */}
          {textEditor.visible && (
            <div
              className="absolute"
              style={{
                left: `${(textEditor.x / (canvasRef.current?.width || 1)) * 100}%`,
                top: `${(textEditor.y / (canvasRef.current?.height || 1)) * 100}%`,
                transform: "translateY(-1em)",
              }}
            >
              <input
                autoFocus
                value={textEditor.value}
                onChange={(e) => setTextEditor((t) => ({ ...t, value: e.target.value }))}
                onBlur={() => commitText(textEditor.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitText(textEditor.value)
                  }
                  if (e.key === "Escape") {
                    setTextEditor({ visible: false, x: 0, y: 0, value: "" })
                  }
                }}
                className="px-2 py-1 rounded-md border border-border bg-card text-card-foreground shadow"
                placeholder="Type and press Enter…"
                style={{ fontSize: Math.max(12, size * 1.5) }}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
