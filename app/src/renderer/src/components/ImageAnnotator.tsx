import { useEffect, useRef, useState } from 'react'
import { Arrow, Circle, Image as KImage, Layer, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { ArrowUpRight, Hash, MousePointer2, Square, Type, Undo2, X } from 'lucide-react'

type Tool = 'select' | 'rect' | 'arrow' | 'number' | 'text'

interface Shape {
  id: string
  tool: Exclude<Tool, 'select'>
  x: number
  y: number
  w: number
  h: number
  color: string
  label?: string
}

const COLORS = ['#f38ba8', '#fab387', '#a6e3a1', '#89b4fa', '#cba6f7']
const MAX_W = 900
const MAX_H = 560

/** 이미지 위에 사각형·화살표·번호·텍스트를 얹고 PNG 로 내보낸다 (기획서 10장) */
export default function ImageAnnotator({
  src,
  onCancel,
  onSave,
}: {
  src: string
  onCancel: () => void
  onSave: (dataUrl: string) => void
}) {
  const [img, setImg] = useState<HTMLImageElement>()
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState(COLORS[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape>()
  const [textAt, setTextAt] = useState<{ x: number; y: number }>()
  const [textValue, setTextValue] = useState('')
  const stageRef = useRef<Konva.Stage>(null)

  useEffect(() => {
    const el = new window.Image()
    el.onload = () => setImg(el)
    el.src = src
  }, [src])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  if (!img) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/80">
        <span className="text-sm text-subtext0">이미지 불러오는 중…</span>
      </div>
    )
  }

  const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1)
  const w = img.width * scale
  const h = img.height * scale
  const nextNumber = shapes.filter((s) => s.tool === 'number').length + 1

  const pos = (): { x: number; y: number } => {
    const p = stageRef.current?.getPointerPosition()
    return { x: p?.x ?? 0, y: p?.y ?? 0 }
  }

  function down(): void {
    if (tool === 'select') return
    const { x, y } = pos()

    if (tool === 'number') {
      setShapes((p) => [
        ...p,
        { id: crypto.randomUUID(), tool, x, y, w: 0, h: 0, color, label: String(nextNumber) },
      ])
      return
    }

    if (tool === 'text') {
      // Electron 에서는 window.prompt 가 동작하지 않는다. 캔버스 위 입력으로 받는다.
      setTextValue('')
      setTextAt({ x, y })
      return
    }
    setDraft({ id: crypto.randomUUID(), tool, x, y, w: 0, h: 0, color })
  }

  function move(): void {
    if (!draft) return
    const { x, y } = pos()
    setDraft({ ...draft, w: x - draft.x, h: y - draft.y })
  }

  function up(): void {
    if (!draft) return
    if (Math.abs(draft.w) > 4 || Math.abs(draft.h) > 4) setShapes((p) => [...p, draft])
    setDraft(undefined)
  }

  function commitText(): void {
    const label = textValue.trim().slice(0, 60)
    if (textAt && label) {
      setShapes((p) => [
        ...p,
        { id: crypto.randomUUID(), tool: 'text', x: textAt.x, y: textAt.y, w: 0, h: 0, color, label },
      ])
    }
    setTextAt(undefined)
    setTextValue('')
  }

  function save(): void {
    setTextAt(undefined)
    // 화면에 맞춰 줄여 그렸으므로 원본 해상도로 되돌려 내보낸다
    const url = stageRef.current?.toDataURL({ pixelRatio: 1 / scale })
    if (url) onSave(url)
  }

  const render = (s: Shape): React.ReactNode => {
    if (s.tool === 'rect') {
      return (
        <Rect
          key={s.id}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          stroke={s.color}
          strokeWidth={3}
          cornerRadius={2}
        />
      )
    }
    if (s.tool === 'arrow') {
      return (
        <Arrow
          key={s.id}
          points={[s.x, s.y, s.x + s.w, s.y + s.h]}
          stroke={s.color}
          fill={s.color}
          strokeWidth={3}
          pointerLength={12}
          pointerWidth={12}
        />
      )
    }
    if (s.tool === 'number') {
      return (
        <>
          <Circle key={`${s.id}-c`} x={s.x} y={s.y} radius={14} fill={s.color} />
          <Text
            key={`${s.id}-t`}
            x={s.x - 14}
            y={s.y - 8}
            width={28}
            align="center"
            text={s.label ?? ''}
            fontSize={16}
            fontStyle="bold"
            fill="#11111b"
          />
        </>
      )
    }
    return (
      <Text
        key={s.id}
        x={s.x}
        y={s.y}
        text={s.label ?? ''}
        fontSize={18}
        fontStyle="bold"
        fill={s.color}
      />
    )
  }

  const TOOLS: { id: Tool; icon: typeof Square; title: string }[] = [
    { id: 'select', icon: MousePointer2, title: '선택' },
    { id: 'rect', icon: Square, title: '사각형' },
    { id: 'arrow', icon: ArrowUpRight, title: '화살표' },
    { id: 'number', icon: Hash, title: '번호' },
    { id: 'text', icon: Type, title: '텍스트' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/80 p-6">
      <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-surface1 bg-mantle">
        <div className="flex items-center gap-2 bg-surface0/40 px-3 py-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.title}
              className={`rounded p-1.5 ${
                tool === t.id ? 'bg-lavender/25 text-lavender' : 'text-subtext0 hover:bg-surface0'
              }`}
            >
              <t.icon className="h-4 w-4" />
            </button>
          ))}

          <div className="mx-1 h-5 w-px bg-surface1" />

          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title="색상"
              style={{ background: c }}
              className={`h-5 w-5 rounded-full ${
                color === c ? 'ring-2 ring-text ring-offset-2 ring-offset-mantle' : ''
              }`}
            />
          ))}

          <div className="mx-1 h-5 w-px bg-surface1" />

          <button
            onClick={() => setShapes((p) => p.slice(0, -1))}
            disabled={shapes.length === 0}
            title="실행 취소"
            className="rounded p-1.5 text-subtext0 hover:bg-surface0 disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0"
            >
              취소
            </button>
            <button
              onClick={save}
              className="rounded-md bg-lavender/20 px-3 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30"
            >
              저장
            </button>
            <button
              onClick={onCancel}
              className="rounded p-1 text-overlay1 hover:text-text"
              title="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative overflow-auto bg-crust p-3">
          {textAt && (
            <input
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitText()
                if (e.key === 'Escape') {
                  setTextAt(undefined)
                  setTextValue('')
                }
              }}
              onBlur={commitText}
              placeholder="텍스트 입력 후 Enter"
              style={{ left: textAt.x + 12, top: textAt.y + 12, color }}
              className="absolute z-10 w-48 rounded border border-lavender bg-mantle px-2 py-1 text-sm font-bold outline-none"
            />
          )}
          <Stage
            ref={stageRef}
            width={w}
            height={h}
            onMouseDown={down}
            onMouseMove={move}
            onMouseUp={up}
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            <Layer>
              <KImage image={img} width={w} height={h} />
              {shapes.map(render)}
              {draft && render(draft)}
            </Layer>
          </Stage>
        </div>

        <div className="px-3 pb-2 pt-1 text-[11px] text-overlay1">
          사각형·화살표는 드래그 · 번호는 클릭 · 텍스트는 클릭 후 입력하고 Enter · Esc 로 닫기
        </div>
      </div>
    </div>
  )
}
