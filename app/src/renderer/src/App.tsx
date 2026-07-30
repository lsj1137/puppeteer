import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleStop,
  FileCode2,
  FolderPlus,
  Bot,
  Gauge,
  PanelRightOpen,
  Pencil,
  Plus,
  KeyRound,
  Loader2,
  FolderOpen,
  MessageSquarePlus,
  Monitor,
  Send,
  ShieldAlert,
  Terminal,
  ImagePlus,
  LayoutDashboard,
  Moon,
  PencilLine,
  Paperclip,
  Sun,
  GitBranch,
  FileDiff,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import ConfirmDialog from './components/ConfirmDialog'
import CommandPalette, { type Command } from './components/CommandPalette'
import ImageAnnotator from './components/ImageAnnotator'
import AgentEditor, { emptyAgent } from './components/AgentEditor'
import Overview from './components/Overview'
import { toggleTheme, useTheme } from './lib/theme'
import type {
  ApprovalDecision,
  ApprovalRequest,
  DetectedRunner,
  RateLimitInfo,
  RunningSession,
  SessionEvent,
  SessionMeta,
  SessionStatus,
  AgentDef,
  ChangedFile,
  CostTotals,
  GitSnapshot,
  RouteCandidate,
  StoredProject,
  StoredSession,
} from '@shared/session'
import Markdown from './components/Markdown'
import ArtifactPanel, { artifactTitle, lineCount } from './components/ArtifactPanel'
import { splitFences, type Segment, type UiArtifact } from './lib/fences'

type Entry =
  | { kind: 'assistant'; id: string; segments: Segment[]; isError?: boolean }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input: unknown; result?: { ok: boolean; preview: string } }
  | { kind: 'user'; id: string; text: string }

interface View {
  entries: Entry[]
  artifacts: UiArtifact[]
  cost: number
  status?: SessionStatus
  statusReason?: string
  meta?: SessionMeta
  rateLimit?: RateLimitInfo
  snapshot?: GitSnapshot
  conflicts: { path: string; otherTitle: string }[]
}

const EMPTY: View = { entries: [], artifacts: [], cost: 0, conflicts: [] }

const STATUS: Record<SessionStatus, { label: string; color: string }> = {
  starting: { label: '시작 중', color: 'text-sky' },
  running: { label: '실행 중', color: 'text-green' },
  'waiting-input': { label: '입력 대기', color: 'text-yellow' },
  'approval-required': { label: '승인 대기', color: 'text-peach' },
  completed: { label: '완료', color: 'text-subtext0' },
  failed: { label: '실패', color: 'text-red' },
  stopped: { label: '중지됨', color: 'text-subtext0' },
  disconnected: { label: '연결 끊김', color: 'text-maroon' },
  'auth-required': { label: '로그인 필요', color: 'text-yellow' },
}

const RISK: Record<string, { ring: string; text: string; label: string }> = {
  high: { ring: 'border-red/50 bg-red/5', text: 'text-red', label: '높음' },
  med: { ring: 'border-peach/50 bg-peach/5', text: 'text-peach', label: '보통' },
  low: { ring: 'border-surface1 bg-surface0/40', text: 'text-subtext0', label: '낮음' },
}

const runnerLabel = (r: DetectedRunner): string =>
  (r.kind === 'wsl' ? `WSL · ${r.distro}` : r.kind === 'windows-native' ? 'Windows' : r.kind) +
  (r.version ? ` · ${r.version}` : '')

const RunnerIcon = ({ r, ...p }: { r: DetectedRunner; className?: string }) =>
  r.kind === 'wsl' ? <Terminal {...p} /> : <Monitor {...p} />

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/**
 * 큰 이미지는 `String.fromCharCode(...arr)` 로 한 번에 못 바꾼다.
 * 인자 개수 제한에 걸려 RangeError 가 난다(스크린샷 몇 MB면 바로 터짐).
 */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** 도구 칩에 보여줄 인자 요약. JSON 통째로 뿌리면 읽기 어렵다. */
function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (k: string): string | undefined =>
    typeof i[k] === 'string' ? (i[k] as string) : undefined
  return (
    pick('command') ??
    pick('file_path') ??
    pick('notebook_path') ??
    pick('pattern') ??
    pick('url') ??
    pick('query') ??
    pick('description') ??
    JSON.stringify(i).slice(0, 120)
  )
}

const timeLabel = (ms: number): string =>
  new Date(ms).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** 이벤트 하나를 화면 상태에 반영. 실시간 수신과 DB 복원이 같은 경로를 탄다. */
function reduce(v: View, e: SessionEvent, key: string): View {
  switch (e.t) {
    case 'status':
      return { ...v, status: e.status, statusReason: e.reason }
    case 'session-meta':
      return { ...v, meta: e.meta }
    case 'rate-limit':
      return { ...v, rateLimit: e.info }
    case 'message': {
      if (e.role === 'user') {
        return { ...v, entries: [...v.entries, { kind: 'user', id: key, text: e.text }] }
      }
      // API 오류는 대화 본문과 섞지 않는다
      if (e.isError) {
        return {
          ...v,
          entries: [...v.entries, { kind: 'assistant', id: key, segments: [], isError: true }],
          artifacts: v.artifacts,
          statusReason: e.text,
        }
      }
      const { segments, artifacts } = splitFences(e.text, key)
      return {
        ...v,
        entries: [...v.entries, { kind: 'assistant', id: key, segments }],
        artifacts: [...v.artifacts, ...artifacts],
      }
    }
    case 'tool-use':
      return {
        ...v,
        entries: [
          ...v.entries,
          { kind: 'tool', id: key, toolUseId: e.toolUseId, name: e.name, input: e.input },
        ],
      }
    case 'tool-result':
      return {
        ...v,
        entries: v.entries.map((en) =>
          en.kind === 'tool' && en.toolUseId === e.toolUseId
            ? { ...en, result: { ok: e.ok, preview: e.preview } }
            : en,
        ),
      }
    case 'artifact':
      return {
        ...v,
        artifacts: [
          ...v.artifacts,
          {
            id: `${key}-log`,
            kind: e.kind === 'diff' ? 'diff' : 'log',
            language: e.language,
            path: e.path,
            content: e.content,
          },
        ],
      }
    case 'snapshot':
      return { ...v, snapshot: e.snapshot }
    case 'conflict':
      return v.conflicts.some((c) => c.path === e.path)
        ? v
        : { ...v, conflicts: [...v.conflicts, { path: e.path, otherTitle: e.otherTitle }] }
    case 'usage':
      return { ...v, cost: e.usage.totalCostUsd }
    default:
      return v
  }
}

/** Artifact 패널 폭. 너무 좁으면 코드가 안 읽히고, 너무 넓으면 대화가 눌린다. */
const clampW = (w: number): number => Math.max(280, Math.min(760, Math.round(w)))

/** 탭 하나가 제목을 알아볼 수 있는 최소 폭. 이보다 좁아지느니 목록으로 뺀다. */
const MIN_TAB = 116
/** 새 세션 버튼 자리 */
const TAB_RESERVE = 44

/**
 * 들어갈 수 있는 만큼만 탭으로 그리고 나머지는 넘침 목록으로 보낸다.
 * 활성 세션은 넘침에 있어도 반드시 탭으로 끌어올린다 — 지금 보는 게 안 보이면 안 된다.
 */
function splitTabs(
  sessions: StoredSession[],
  activeId: string | undefined,
  room: number,
): { visible: StoredSession[]; overflow: StoredSession[] } {
  const fit = Math.max(1, Math.floor((room - TAB_RESERVE) / MIN_TAB))
  if (room === 0 || sessions.length <= fit) return { visible: sessions, overflow: [] }

  let visible = sessions.slice(0, fit)
  if (activeId && !visible.some((s) => s.id === activeId)) {
    const active = sessions.find((s) => s.id === activeId)
    if (active) visible = [...sessions.slice(0, fit - 1), active]
  }
  const shown = new Set(visible.map((s) => s.id))
  return { visible, overflow: sessions.filter((s) => !shown.has(s.id)) }
}

export default function App() {
  const [runners, setRunners] = useState<DetectedRunner[]>([])
  const [projects, setProjects] = useState<StoredProject[]>([])
  const [active, setActive] = useState<string>()

  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [activeSession, setActiveSession] = useState<string>()
  const [running, setRunning] = useState<RunningSession[]>([])

  /** 세션별 화면 상태. 여러 세션이 동시에 돌아도 각자 쌓인다. */
  const [views, setViews] = useState<Record<string, View>>({})
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [prompt, setPrompt] = useState('')
  const [pendingPick, setPendingPick] = useState<string>()
  const [selectedArtifact, setSelectedArtifact] = useState<string>()
  const [confirmDrop, setConfirmDrop] = useState<string>()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [attachments, setAttachments] = useState<{ path: string; url: string; name: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [annotating, setAnnotating] = useState<number>()
  const [showOverview, setShowOverview] = useState(false)
  const [cost, setCost] = useState<CostTotals>({ today: 0, month: 0, all: 0 })
  const [now, setNow] = useState(Date.now())
  /** 대화가 위로 스크롤됐는지 — 페이드·그림자를 그때만 보인다 */
  const [scrolled, setScrolled] = useState(false)
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agentName, setAgentName] = useState<string>()
  const [agentMenu, setAgentMenu] = useState(false)
  const [tabMenu, setTabMenu] = useState(false)
  /** 탭바 가용 폭 — 창 크기·Artifact 폭에 따라 바뀌므로 관찰한다 */
  const [tabRoom, setTabRoom] = useState(0)
  const [confirmDelSession, setConfirmDelSession] = useState<StoredSession>()
  const [editing, setEditing] = useState<{ agent: AgentDef; isNew: boolean }>()
  const [artifactsOpen, setArtifactsOpen] = useState(
    () => localStorage.getItem('ws.artifacts') !== 'closed',
  )
  const [artifactW, setArtifactW] = useState(
    () => clampW(Number(localStorage.getItem('ws.artifactW')) || 380),
  )

  /** 패널 왼쪽 손잡이를 끌어 폭을 조절한다. 창 오른쪽 끝에서 마우스까지의 거리가 곧 폭이다. */
  function startResize(e: React.PointerEvent): void {
    e.preventDefault()
    const move = (ev: PointerEvent): void => setArtifactW(clampW(window.innerWidth - ev.clientX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setArtifactW((w) => {
        localStorage.setItem('ws.artifactW', String(w))
        return w
      })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function toggleArtifacts(): void {
    setArtifactsOpen((v) => {
      localStorage.setItem('ws.artifacts', v ? 'closed' : 'open')
      return !v
    })
  }
  const theme = useTheme()

  const scrollRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const seq = useRef(0)

  const view = (activeSession && views[activeSession]) || EMPTY
  const activeProject = projects.find((p) => p.path === active)
  const activeRunner = runners.find((r) => r.id === activeProject?.runnerId)
  const claudeRunners = runners.filter((r) => r.provider === 'claude-cli')
  const selected = sessions.find((s) => s.id === activeSession)
  const { visible: visibleTabs, overflow: overflowTabs } = splitTabs(sessions, activeSession, tabRoom)
  /** 활성 세션이 실행 중일 때만 입력을 잠근다. 다른 세션은 계속 돌아도 된다. */
  const busy = running.some((r) => r.id === activeSession)

  const myApprovals = approvals.filter((a) => a.sessionId === activeSession)
  const otherApprovals = approvals.filter((a) => a.sessionId !== activeSession)
  /** rate limit 창의 경과 비율. resetsAt 만 오므로 종류별 창 길이로 역산한다. */
  const limit = ((): { ratio: number; label: string; remain: string } | undefined => {
    const rl = view.rateLimit
    if (!rl?.resetsAt) return undefined
    const windowSec = rl.rateLimitType === 'weekly' ? 604800 : 18000
    const left = Math.max(0, rl.resetsAt * 1000 - now)
    const ratio = Math.min(1, Math.max(0, 1 - left / (windowSec * 1000)))
    const h = Math.floor(left / 3600000)
    const m = Math.floor((left % 3600000) / 60000)
    return {
      ratio,
      label: rl.rateLimitType === 'weekly' ? '주간' : '5시간',
      remain: h > 0 ? `${h}시간 ${m}분` : `${m}분`,
    }
  })()

  const isEmpty = !active || (view.entries.length === 0 && myApprovals.length === 0 && !view.status)

  // ── 초기 로드 ──
  useEffect(() => {
    void window.api.detectRunners().then(setRunners)
    void window.api.listProjects().then((ps) => {
      setProjects(ps)
      if (ps[0]) setActive(ps[0].path)
    })
    void window.api.listOpenApprovals().then(setApprovals)
  }, [])

  const refresh = useCallback(async (projectPath?: string) => {
    setRunning(await window.api.listRunningSessions())
    setCost(await window.api.costTotals())
    if (projectPath) setSessions(await window.api.listSessions(projectPath))
  }, [])

  // 한도 리셋까지 남은 시간 표시용
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (active) void refresh(active)
    else setSessions([])
  }, [active, refresh])

  const reloadAgents = useCallback(async (projectPath?: string) => {
    setAgents(projectPath ? await window.api.listAgents(projectPath) : [])
  }, [])

  useEffect(() => {
    void reloadAgents(active)
    setAgentName(undefined)
  }, [active, reloadAgents])

  useLayoutEffect(() => {
    const el = tabBarRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setTabRoom(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showOverview])

  // ── 실시간 이벤트 — 세션별로 라우팅 ──
  useEffect(() => {
    return window.api.onSessionEvent(({ sessionId, event }) => {
      setViews((vs) => ({
        ...vs,
        [sessionId]: reduce(vs[sessionId] ?? EMPTY, event, `e${seq.current++}`),
      }))
      if (event.t === 'status') void refresh(active)
    })
  }, [active, refresh])

  useEffect(() => {
    return window.api.onApprovalRequest((req) => {
      setApprovals((prev) =>
        prev.some((a) => a.id === req.id)
          ? prev.map((a) => (a.id === req.id ? req : a))
          : [...prev, req],
      )
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [view.entries, myApprovals.length])

  // 변경 파일은 세션이 바뀌거나 멈출 때 갱신한다
  useEffect(() => {
    if (!activeSession) return setChanges([])
    void window.api.listChanges(activeSession).then(setChanges)
  }, [activeSession, view.status])

  // 파일 드래그 — 창 전체에서 받는다.
  // 입력창에만 걸면 textarea 등 자식이 삼키고, preventDefault 를 놓치면
  // Electron 이 기본 동작으로 그 파일을 열어버린다.
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragOver(true)
    }
    const onLeave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragOver(false)
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer?.files) void attachFiles(e.dataTransfer.files)
    }

    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  })

  // 클립보드 이미지 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f))
      if (files.length) {
        e.preventDefault()
        void attachFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  // Command Palette — Ctrl+Space
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 5줄까지는 창이 늘어나고, 그 뒤부터 스크롤이 생긴다
  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 22
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const max = lh * 5 + pad

    el.style.height = 'auto'
    const needed = el.scrollHeight
    el.style.height = `${Math.min(needed, max)}px`
    el.style.overflowY = needed > max ? 'auto' : 'hidden'
  }, [prompt])

  // ── 동작 ──
  /** 이미지 파일을 프로젝트 내부 attachments 로 저장하고 미리보기를 만든다 */
  async function attachFiles(files: FileList | File[]): Promise<void> {
    if (!active) return
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      const b64 = await toBase64(f)
      const saved = await window.api.saveAttachment(active, f.name || 'paste.png', b64)
      setAttachments((prev) => [
        ...prev,
        { path: saved, name: f.name || 'paste.png', url: URL.createObjectURL(f) },
      ])
    }
  }

  async function saveAnnotation(index: number, dataUrl: string): Promise<void> {
    if (!active) return
    const b64 = dataUrl.split(',')[1] ?? ''
    const saved = await window.api.saveAttachment(active, 'annotated.png', b64)
    setAttachments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, path: saved, url: dataUrl, name: '주석 이미지' } : a)),
    )
    setAnnotating(undefined)
  }

  async function openDiff(path: string): Promise<void> {
    if (!activeSession) return
    const content = await window.api.fileDiff(activeSession, path)
    const id = `diff:${path}`
    setViews((vs) => {
      const v = vs[activeSession] ?? EMPTY
      if (v.artifacts.some((a) => a.id === id)) return vs
      return {
        ...vs,
        [activeSession]: {
          ...v,
          artifacts: [
            ...v.artifacts,
            { id, kind: 'diff', language: 'diff', path, content: content || '(변경 없음)' },
          ],
        },
      }
    })
    setSelectedArtifact(id)
  }

  function decide(id: string, decision: ApprovalDecision): void {
    void window.api.resolveApproval(id, decision)
    setApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  function selectProject(path: string): void {
    setShowOverview(false)
    setScrolled(false)
    setActive(path)
    setActiveSession(undefined)
    setSelectedArtifact(undefined)
    setAttachments([])
  }

  /**
   * 홈에서 라우팅한 지시를 실제로 실행한다.
   * 실행 환경은 여기서 임의로 정하지 않는다 — 프로젝트에 아직 없으면
   * 일반 세션과 똑같이 첫 지시 시점에 사용자가 고르게 한다.
   */
  async function runRouted(c: RouteCandidate, text: string): Promise<void> {
    selectProject(c.projectPath)
    setAgentName(c.agentName)

    const proj = projects.find((p) => p.path === c.projectPath)
    const runner = runners.find((r) => r.id === proj?.runnerId)
    if (runner) return void run(runner.id, text, c.projectPath)
    if (claudeRunners.length === 1) return void chooseRunner(claudeRunners[0].id, text, c.projectPath)

    // 고를 게 여럿이면 선택 UI 를 띄우고 멈춘다
    setPendingPick(text)
  }

  /** 세션 열기. 이미 메모리에 있으면 그대로, 아니면 DB 에서 복원한다. */
  async function openSession(id: string): Promise<void> {
    setShowOverview(false)
    setScrolled(false)
    setActiveSession(id)
    setAgentName(sessions.find((x) => x.id === id)?.agentName ?? undefined)
    setSelectedArtifact(undefined)
    if (views[id]) return
    const stored = await window.api.listEvents(id)
    let v = EMPTY
    for (const s of stored) v = reduce(v, s.event, `h${s.id}`)
    setViews((vs) => ({ ...vs, [id]: v }))
  }

  /** 다른 프로젝트의 세션으로 이동 */
  async function jumpTo(sessionId: string, projectPath: string): Promise<void> {
    if (projectPath !== active) {
      setActive(projectPath)
      setSessions(await window.api.listSessions(projectPath))
    }
    await openSession(sessionId)
  }

  async function removeSession(id: string): Promise<void> {
    setConfirmDelSession(undefined)
    await window.api.deleteSession(id)
    setViews((vs) => {
      const next = { ...vs }
      delete next[id]
      return next
    })
    if (activeSession === id) {
      setActiveSession(undefined)
      setSelectedArtifact(undefined)
    }
    void refresh(active)
  }

  function newSession(): void {
    setScrolled(false)
    setActiveSession(undefined)
    setSelectedArtifact(undefined)
    taRef.current?.focus()
  }

  async function pickFolder(): Promise<void> {
    const p = await window.api.pickProject()
    if (!p) return
    setProjects(await window.api.listProjects())
    selectProject(p)
  }

  async function dropProject(path: string): Promise<void> {
    setConfirmDrop(undefined)
    await window.api.removeProject(path)
    const next = await window.api.listProjects()
    setProjects(next)
    if (path === active) selectProject(next[0]?.path ?? '')
  }

  function submit(): void {
    const text = prompt.trim()
    if (!active || !text || busy) return

    const runnerId = activeProject?.runnerId
    if (runnerId && runners.some((r) => r.id === runnerId)) return void run(runnerId, text)
    if (claudeRunners.length === 1) return void chooseRunner(claudeRunners[0].id, text)

    setPendingPick(text)
    setPrompt('')
  }

  /**
   * cwd 를 명시로 받는 이유: 홈에서 라우팅해 들어오면 selectProject 직후라
   * `active` 상태가 아직 반영되지 않았다.
   */
  async function chooseRunner(runnerId: string, text?: string, cwd?: string): Promise<void> {
    const path = cwd ?? active
    if (!path) return
    await window.api.setProjectRunner(path, runnerId)
    setProjects(await window.api.listProjects())
    const body = text ?? pendingPick
    setPendingPick(undefined)
    if (body) void run(runnerId, body, path)
  }

  async function run(runnerId: string, text: string, cwd?: string): Promise<void> {
    const runner = runners.find((r) => r.id === runnerId)
    const path = cwd ?? active
    if (!runner || !path) return

    // 열어둔 세션이 있으면 그 CLI 세션을 이어간다.
    // 앱 세션도 새로 만들지 않고 그대로 이어간다 — 한 대화가 턴마다 쪼개지면 안 된다.
    const resumeCliSessionId = selected?.cliSessionId ?? undefined
    const continueSessionId = resumeCliSessionId ? activeSession : undefined
    setPrompt('')

    try {
      const id = await window.api.startSession({
        runner,
        cwd: path,
        prompt: text,
        resumeCliSessionId,
        continueSessionId,
        attachments: attachments.map((a) => a.path),
        agentName,
      })
      setAttachments([])
      // 사용자 지시는 main 이 이벤트로 되돌려주므로 여기서 따로 넣지 않는다
      setActiveSession(id)
      setSelectedArtifact(undefined)
      void refresh(path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const key = activeSession ?? 'start-error'
      setViews((vs) => ({
        ...vs,
        [key]: { ...(vs[key] ?? EMPTY), status: 'failed', statusReason: msg },
      }))
      setActiveSession(key)
    }
  }

  const commands: Command[] = [
    {
      id: 'act:new',
      group: '명령',
      label: '새 세션',
      icon: MessageSquarePlus,
      run: newSession,
    },
    {
      id: 'act:overview',
      group: '명령',
      label: 'Overview 열기',
      icon: LayoutDashboard,
      run: () => setShowOverview(true),
    },
    ...agents.map((a) => ({
      id: `ag:${a.name}`,
      group: '에이전트',
      label: `${a.name} 로 실행`,
      hint: a.description,
      icon: Bot,
      run: () => setAgentName(a.name),
    })),
    ...(active
      ? [
          {
            id: 'act:agent-new',
            group: '명령',
            label: '새 에이전트 만들기',
            icon: Plus,
            run: () => setEditing({ agent: emptyAgent(active), isNew: true }),
          },
        ]
      : []),
    ...(selected
      ? [
          {
            id: 'act:session-del',
            group: '명령',
            label: '현재 세션 삭제',
            hint: selected.title ?? '',
            icon: Trash2,
            run: () => setConfirmDelSession(selected),
          },
        ]
      : []),
    {
      id: 'act:artifacts',
      group: '명령',
      label: artifactsOpen ? 'Artifacts 패널 접기' : 'Artifacts 패널 펼치기',
      icon: artifactsOpen ? PanelRightOpen : PanelRightOpen,
      run: toggleArtifacts,
    },
    {
      id: 'act:theme',
      group: '명령',
      label: theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환',
      icon: theme === 'dark' ? Sun : Moon,
      run: toggleTheme,
    },
    {
      id: 'act:add',
      group: '명령',
      label: '프로젝트 폴더 추가',
      icon: FolderPlus,
      run: () => void pickFolder(),
    },
    ...(active
      ? [
          {
            id: 'act:reveal',
            group: '명령',
            label: '탐색기에서 프로젝트 열기',
            hint: baseName(active),
            icon: FolderOpen,
            run: () => void window.api.revealProject(active),
          },
          {
            id: 'act:runner',
            group: '명령',
            label: '실행 환경 변경',
            hint: activeRunner ? runnerLabel(activeRunner) : '미지정',
            icon: Terminal,
            run: () => setPendingPick(''),
          },
        ]
      : []),
    ...approvals.map((a) => ({
      id: `ap:${a.id}`,
      group: '승인 대기',
      label: `${a.tool} 승인 요청`,
      hint: baseName(a.cwd),
      icon: ShieldAlert,
      run: () => void jumpTo(a.sessionId, a.cwd),
    })),
    ...running.map((r) => ({
      id: `run:${r.id}`,
      group: '실행 중',
      label: r.title,
      hint: baseName(r.projectPath),
      icon: Loader2,
      run: () => void jumpTo(r.id, r.projectPath),
    })),
    ...projects.map((p) => ({
      id: `pj:${p.path}`,
      group: '프로젝트',
      label: baseName(p.path),
      hint: p.path,
      icon: FolderOpen,
      run: () => selectProject(p.path),
    })),
    ...sessions.map((sn) => ({
      id: `ss:${sn.id}`,
      group: '세션',
      label: sn.title || '(제목 없음)',
      hint: timeLabel(sn.startedAt),
      icon: MessageSquarePlus,
      run: () => void openSession(sn.id),
    })),
  ]

  return (
    <div
      className="grid h-full grid-rows-[auto_1fr_auto] bg-base text-text"
      style={{ gridTemplateColumns: `264px 1fr ${artifactsOpen ? artifactW : 40}px` }}
    >
      {/* ── Rail ─────────────────────────────────── */}
      <aside className="col-start-1 row-start-1 row-end-4 flex flex-col gap-3.5 overflow-auto border-r border-surface0 bg-mantle p-2.5">
        <div className="flex items-center gap-2 px-1 pt-1">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-mauve/20">
            <Terminal className="h-3.5 w-3.5 text-mauve" />
          </div>
          <span className="text-sm font-semibold">Agent Workspace</span>
        </div>

        <button
          onClick={() => setShowOverview(true)}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            showOverview ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
          }`}
        >
          <LayoutDashboard className="h-4 w-4 text-sapphire" />
          Overview
        </button>

        {/* 중앙 승인 — 다른 프로젝트/세션의 요청도 모두 모인다 */}
        {approvals.length > 0 && (
          <section className="rounded-md border border-peach/40 bg-peach/5 p-2">
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-peach">
              <ShieldAlert className="h-3.5 w-3.5" />
              승인 대기 {approvals.length}
            </div>
            {approvals.map((a) => (
              <button
                key={a.id}
                onClick={() => void jumpTo(a.sessionId, a.cwd)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface0"
              >
                <span className="font-mono text-subtext1">{a.tool}</span>
                <span className="flex-1 truncate text-overlay1">{baseName(a.cwd)}</span>
                {a.sessionId === activeSession && (
                  <span className="shrink-0 text-[11px] text-peach">현재</span>
                )}
              </button>
            ))}
          </section>
        )}

        {/* 실행 중 — 프로젝트를 넘어 전체 */}
        {running.length > 0 && (
          <section>
            <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
              실행 중 {running.length}
            </div>
            {running.map((r) => (
              <button
                key={r.id}
                onClick={() => void jumpTo(r.id, r.projectPath)}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] ${
                  r.id === activeSession ? 'bg-surface0' : 'hover:bg-surface0/50'
                }`}
              >
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-green" />
                <span className="flex-1 truncate text-subtext1">{r.title}</span>
                <span className="shrink-0 text-overlay1">{baseName(r.projectPath)}</span>
              </button>
            ))}
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-overlay1">
              프로젝트
            </span>
            <button
              onClick={() => void pickFolder()}
              className="rounded p-1 text-subtext0 hover:bg-surface0 hover:text-text"
              title="폴더 추가"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>

          {projects.length === 0 && (
            <div className="px-1 text-[12px] text-overlay1">＋ 로 폴더를 추가하세요</div>
          )}

          <div className="space-y-0.5">
            {projects.map((p) => {
              const r = runners.find((x) => x.id === p.runnerId)
              const on = p.path === active
              const live = running.filter((x) => x.projectPath === p.path).length
              return (
                <div
                  key={p.path}
                  onClick={() => selectProject(p.path)}
                  className={`group cursor-pointer rounded-md px-2 py-1.5 ${
                    on ? 'bg-surface0' : 'hover:bg-surface0/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`flex-1 truncate text-sm ${on ? 'text-text' : 'text-subtext1'}`}
                      title={p.path}
                    >
                      {baseName(p.path)}
                    </span>
                    {live > 0 && (
                      <span className="shrink-0 rounded bg-green/20 px-1 text-[11px] text-green">
                        {live}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDrop(p.path)
                      }}
                      className="hidden rounded p-0.5 text-overlay1 hover:bg-red/20 hover:text-red group-hover:block"
                      title="목록에서 제거 (폴더는 삭제되지 않음)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-overlay1">
                    {r ? (
                      <>
                        <RunnerIcon r={r} className="h-3 w-3" />
                        {runnerLabel(r)}
                      </>
                    ) : (
                      '실행 환경 미지정'
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="mt-auto space-y-1.5 border-t border-surface0 px-1 pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            <Gauge className="h-3.5 w-3.5" />
            사용량
          </div>

          {limit && (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface0">
                <div
                  className={`h-full rounded-full transition-all ${
                    limit.ratio > 0.85 ? 'bg-peach' : 'bg-green'
                  }`}
                  style={{ width: `${Math.round(limit.ratio * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-overlay1">
                <span>{limit.label} 한도</span>
                <span>{limit.remain} 남음</span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-overlay1">오늘</span>
            <span className="font-mono tabular-nums text-subtext1">${cost.today.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-overlay1">이번 달</span>
            <span className="font-mono tabular-nums text-subtext1">${cost.month.toFixed(2)}</span>
          </div>
          {view.cost > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-overlay1">현재 세션</span>
              <span className="font-mono tabular-nums text-text">${view.cost.toFixed(4)}</span>
            </div>
          )}
        </section>
      </aside>

      {/* ── Session Tabs ─────────────────────────── */}
      {!showOverview && active && (
        <div className="col-start-2 col-end-4 row-start-1 z-20 flex items-end bg-mantle pl-2 pr-2 pt-1">
          <div ref={tabBarRef} className="flex min-w-0 flex-1 items-end gap-0.5">
            {visibleTabs.map((s) => {
            const on = s.id === activeSession
            const live = running.some((r) => r.id === s.id)
            const waiting = approvals.some((a) => a.sessionId === s.id)
            return (
              <div
                key={s.id}
                onClick={() => void openSession(s.id)}
                title={s.title ?? ''}
                className={`group flex min-w-0 max-w-[220px] flex-1 cursor-pointer items-center gap-1.5 rounded-t-lg py-1.5 pl-3 pr-1.5 text-[13px] ${
                  on ? 'bg-base text-text' : 'text-subtext0 hover:bg-surface0/60'
                }`}
              >
                {live ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-green" />
                ) : waiting ? (
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-peach" />
                ) : (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      s.status === 'failed'
                        ? 'bg-red'
                        : s.status === 'completed'
                          ? 'bg-surface2'
                          : 'bg-yellow'
                    }`}
                  />
                )}
                <span className="flex-1 truncate">{s.title || '새 세션'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDelSession(s)
                  }}
                  title="세션 삭제"
                  className={`rounded p-0.5 text-overlay1 hover:bg-red/20 hover:text-red ${
                    on ? '' : 'invisible group-hover:visible'
                  }`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}

            {overflowTabs.length > 0 && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setTabMenu((v) => !v)}
                  title={`세션 ${overflowTabs.length}개 더`}
                  className="mb-px flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-[12px] text-subtext0 hover:bg-surface0/60 hover:text-text"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {overflowTabs.length}
                </button>
                {tabMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setTabMenu(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-surface1 bg-mantle py-1 shadow-lg">
                      {overflowTabs.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setTabMenu(false)
                            void openSession(s.id)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              s.status === 'failed'
                                ? 'bg-red'
                                : s.status === 'completed'
                                  ? 'bg-surface2'
                                  : 'bg-yellow'
                            }`}
                          />
                          <span className="truncate">{s.title || '새 세션'}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={newSession}
              title="새 세션"
              className={`mb-px flex shrink-0 items-center gap-1 rounded-t-lg px-2.5 py-1.5 text-[13px] ${
                activeSession === undefined ? 'bg-base text-text' : 'text-subtext0 hover:bg-surface0/60'
              }`}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 flex shrink-0 items-center gap-1.5 pl-2">
            <div className="relative">
              <button
                onClick={() => setAgentMenu((v) => !v)}
                title="Project Agent 선택"
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                  agentName
                    ? 'bg-mauve/20 text-mauve'
                    : 'bg-surface0/60 text-subtext1 hover:bg-surface0 hover:text-text'
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                {agentName ?? '에이전트 없음'}
              </button>

              {agentMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAgentMenu(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-surface1 bg-mantle shadow-xl">
                    <button
                      onClick={() => {
                        setAgentName(undefined)
                        setAgentMenu(false)
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] ${
                        agentName ? 'text-subtext1 hover:bg-surface0' : 'bg-surface0 text-text'
                      }`}
                    >
                      에이전트 없이 실행
                    </button>

                    {agents.map((a) => (
                      <div
                        key={a.name}
                        className={`group flex items-center gap-1 ${
                          a.name === agentName ? 'bg-surface0' : 'hover:bg-surface0/60'
                        }`}
                      >
                        <button
                          onClick={() => {
                            setAgentName(a.name)
                            setAgentMenu(false)
                          }}
                          className="min-w-0 flex-1 px-3 py-2 text-left"
                        >
                          <div className="flex items-center gap-1.5 text-[12px] text-text">
                            <Bot className="h-3.5 w-3.5 shrink-0 text-mauve" />
                            {a.name}
                          </div>
                          {a.description && (
                            <div className="truncate text-[11px] text-overlay1">{a.description}</div>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setEditing({ agent: a, isNew: false })
                            setAgentMenu(false)
                          }}
                          title="편집"
                          className="mr-2 hidden rounded p-1 text-overlay1 hover:text-text group-hover:block"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => {
                        if (active) setEditing({ agent: emptyAgent(active), isNew: true })
                        setAgentMenu(false)
                      }}
                      className="flex w-full items-center gap-1.5 border-t border-surface0 px-3 py-2 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
                    >
                      <Plus className="h-3.5 w-3.5" /> 새 에이전트
                    </button>
                  </div>
                </>
              )}
            </div>

            {activeRunner ? (
              <button
                onClick={() => setPendingPick(prompt.trim() || '')}
                title={`실행 환경 변경 · ${activeRunner.executable}`}
                className="flex items-center gap-1.5 rounded-md bg-surface0/60 px-2 py-1 text-[11px] text-subtext1 hover:bg-surface0 hover:text-text"
              >
                <RunnerIcon r={activeRunner} className="h-3.5 w-3.5 text-sapphire" />
                {runnerLabel(activeRunner)}
              </button>
            ) : (
              <span className="rounded-md border border-dashed border-surface1 px-2 py-1 text-[11px] text-overlay1">
                실행 환경 미지정
              </span>
            )}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
              className="rounded-md p-1.5 text-subtext0 hover:bg-surface0 hover:text-text"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* ── Conversation / Overview ──────────────── */}
      {showOverview ? (
        <main className="col-start-2 col-end-4 row-start-1 row-end-4 min-h-0 overflow-hidden">
          <Overview
            running={running}
            approvals={approvals}
            statusLabel={(st) => STATUS[st]}
            onOpenProject={selectProject}
            onOpenSession={(id, path) => void jumpTo(id, path)}
            runner={activeRunner ?? claudeRunners[0]}
            routeCwd={active || projects[0]?.path}
            onRunAgent={runRouted}
          />
        </main>
      ) : (
      <main
        ref={scrollRef}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        className="col-start-2 row-start-2 flex flex-col overflow-auto px-5 py-4"
      >
        {/* 위로 스크롤됐을 때만 페이드를 띄운다. 항상 띄우면 첫 메시지를 가린다. */}
        <div
          className={`pointer-events-none sticky -top-4 z-10 -mb-9 h-9 shrink-0 bg-gradient-to-b from-base via-base/85 to-transparent transition-opacity duration-200 ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {isEmpty && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-overlay1">
              {active ? '아래에 지시를 입력하세요' : '왼쪽에서 프로젝트 폴더를 추가하세요'}
            </p>
          </div>
        )}

        <div className="space-y-2.5">
          {view.conflicts.map((c) => (
            <div
              key={c.path}
              className="flex gap-2 rounded-lg border border-yellow/50 bg-yellow/10 p-3 text-[12px]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-yellow" />
              <div>
                <div className="font-semibold text-text">동시 수정 감지</div>
                <div className="mt-0.5 text-subtext1">
                  <span className="font-mono">{c.path}</span> 를 다른 세션(
                  <span className="text-subtext0">{c.otherTitle}</span>)도 수정했습니다. 한쪽을
                  중지하거나 결과를 확인하세요.
                </div>
              </div>
            </div>
          ))}

          {view.entries.map((e) =>
            e.kind === 'user' ? (
              <div
                key={e.id}
                className="rounded-lg bg-surface0/50 px-3.5 py-2.5"
              >
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
                  나
                </div>
                <div className="whitespace-pre-wrap text-sm text-text">{e.text}</div>
              </div>
            ) : e.kind === 'tool' ? (
              <div
                key={e.id}
                className={`rounded-md px-3 py-1.5 text-[12px] ${
                  e.result && !e.result.ok ? 'bg-red/10' : 'bg-sapphire/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Wrench
                    className={`h-3.5 w-3.5 shrink-0 ${
                      e.result && !e.result.ok ? 'text-red' : 'text-sapphire'
                    }`}
                  />
                  <span
                    className={`font-medium ${
                      e.result && !e.result.ok ? 'text-red' : 'text-sapphire'
                    }`}
                  >
                    {e.name}
                  </span>
                  <span className="truncate text-subtext0">{toolSummary(e.name, e.input)}</span>
                </div>
                {e.result?.preview && (
                  <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-crust/60 px-2 py-1.5 font-mono text-[12px] leading-relaxed text-subtext0">
                    {e.result.preview}
                  </pre>
                )}
              </div>
            ) : e.isError ? (
              <div
                key={e.id}
                className="flex gap-2 rounded-lg border border-red/50 bg-red/5 p-3 text-[12px] text-red"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">API 오류</div>
                  <div className="mt-0.5 whitespace-pre-wrap text-red/90">{view.statusReason}</div>
                  <div className="mt-1.5 text-[11px] text-overlay1">
                    서버 측 일시 오류입니다. 잠시 후 같은 지시를 다시 보내면 됩니다.
                  </div>
                </div>
              </div>
            ) : (
              <div key={e.id} className="px-0.5">
                {e.segments.map((seg, i) =>
                  seg.type === 'md' ? (
                    <Markdown key={i}>{seg.text}</Markdown>
                  ) : (
                    (() => {
                      const a = view.artifacts.find((x) => x.id === seg.artifactId)
                      if (!a) return null
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedArtifact(a.id)}
                          className={`my-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] ${
                            selectedArtifact === a.id
                              ? 'bg-sapphire/20'
                              : 'bg-surface0/60 hover:bg-surface0'
                          }`}
                        >
                          <FileCode2 className="h-4 w-4 shrink-0 text-sapphire" />
                          <span className="flex-1 truncate text-subtext1">{artifactTitle(a)}</span>
                          <span className="shrink-0 font-mono text-[11px] text-overlay1">
                            {lineCount(a.content)}L
                          </span>
                        </button>
                      )
                    })()
                  ),
                )}
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-2 px-0.5 text-[12px] text-subtext0">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky" />
              {view.status ? STATUS[view.status].label : '시작 중'}
            </div>
          )}

          {myApprovals.map((a) => {
            const r = RISK[a.risk] ?? RISK.low
            return (
              <div key={a.id} className={`rounded-lg border p-3.5 ${r.ring}`}>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <ShieldAlert className={`h-4 w-4 ${r.text}`} />
                  <span className="text-sm font-semibold text-text">승인 요청</span>
                  <span className="rounded bg-surface0 px-1.5 py-0.5 font-mono text-[12px] text-subtext1">
                    {a.tool}
                  </span>
                  <span className={`text-[11px] ${r.text}`}>위험도 {r.label}</span>
                  {a.pending && (
                    <span className="rounded bg-yellow/20 px-1.5 py-0.5 text-[11px] text-yellow">
                      보류됨
                    </span>
                  )}
                </div>

                <pre className="mb-2 max-h-40 overflow-auto rounded-md bg-crust p-2.5 font-mono text-[12px] leading-relaxed text-subtext1">
                  {JSON.stringify(a.input, null, 2)}
                </pre>
                <div className="mb-3 truncate text-[11px] text-overlay1">{a.cwd}</div>

                {a.pending ? (
                  <div className="text-[12px] text-yellow">
                    응답 대기 시간이 지나 세션에는 보류로 통보했습니다.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => decide(a.id, 'allow-once')}
                      className="flex items-center gap-1.5 rounded-md bg-green/15 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/25"
                    >
                      <Check className="h-3.5 w-3.5" /> 이번만 허용
                    </button>
                    <button
                      onClick={() => decide(a.id, 'allow-session')}
                      className="rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
                    >
                      이 세션 동안 허용
                    </button>
                    <button
                      onClick={() => decide(a.id, 'deny')}
                      className="flex items-center gap-1.5 rounded-md bg-red/15 px-3 py-1.5 text-[12px] font-medium text-red hover:bg-red/25"
                    >
                      <X className="h-3.5 w-3.5" /> 거부
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {view.status === 'auth-required' && (
            <div className="rounded-lg border border-yellow/50 bg-yellow/5 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-yellow" />
                <span className="text-sm font-semibold text-text">로그인이 필요합니다</span>
              </div>
              <div className="mb-2 text-[12px] text-subtext1">
                이 실행 환경의 CLI가 인증되지 않았습니다. 아래 명령을 터미널에서 실행해
                로그인한 뒤 다시 시도하세요.
              </div>
              <code className="block rounded-md bg-crust px-2.5 py-2 font-mono text-[12px] text-yellow">
                {activeRunner?.kind === 'wsl'
                  ? `wsl -d ${activeRunner.distro} -- ${activeRunner.executable} /login`
                  : `${activeRunner?.executable ?? 'claude'} /login`}
              </code>
            </div>
          )}

          {view.statusReason && view.status === 'failed' && (
            <div className="flex gap-2 rounded-lg border border-red/50 bg-red/5 p-3.5 text-[12px] text-red">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap">{view.statusReason}</span>
            </div>
          )}
        </div>
      </main>
      )}

      {/* ── Artifacts ────────────────────────────── */}
      {!showOverview && !artifactsOpen && (
        <aside className="col-start-3 row-start-2 row-end-4 flex flex-col items-center gap-2 border-l border-surface0 bg-mantle py-2.5">
          <button
            onClick={toggleArtifacts}
            title="Artifacts 펼치기"
            className="rounded p-1.5 text-subtext0 hover:bg-surface0 hover:text-text"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
          {view.artifacts.length > 0 && (
            <span className="rounded bg-sapphire/20 px-1 text-[11px] text-sapphire">
              {view.artifacts.length}
            </span>
          )}
          {changes.length > 0 && (
            <span className="rounded bg-peach/20 px-1 text-[11px] text-peach">{changes.length}</span>
          )}
        </aside>
      )}

      {!showOverview && artifactsOpen && (
      <aside className="relative col-start-3 row-start-2 row-end-4 flex min-h-0 flex-col overflow-hidden border-l border-surface0 bg-mantle">
        <div
          onPointerDown={startResize}
          onDoubleClick={() => {
            setArtifactW(380)
            localStorage.setItem('ws.artifactW', '380')
          }}
          title="드래그로 폭 조절 · 더블클릭으로 초기화"
          className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-lavender/40"
        />
        {(view.snapshot || changes.length > 0) && (
          <div className="shrink-0 border-b border-surface0 px-2.5 pb-2.5 pt-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
              <GitBranch className="h-3.5 w-3.5" />
              Git
            </div>
            {view.snapshot && (
              <div className="mb-2 flex items-center gap-1.5 pl-0.5 text-[11px]">
                <span className="rounded bg-surface0 px-1.5 py-0.5 text-subtext1">
                  {view.snapshot.branch}
                </span>
                <span className="font-mono text-overlay1">{view.snapshot.head}</span>
              </div>
            )}
            {changes.length > 0 && (
              <>
                <div className="mb-1 text-[11px] text-overlay1">
                  세션 시작 이후 변경 {changes.length}건
                </div>
                <div className="max-h-28 overflow-auto">
                  {changes.map((c) => (
                    <button
                      key={c.path}
                      onClick={() => void openDiff(c.path)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface0"
                    >
                      <span
                        className={`shrink-0 font-mono text-[11px] font-bold ${
                          c.status === '??' ? 'text-green' : c.status === 'D' ? 'text-red' : 'text-yellow'
                        }`}
                        title={
                          c.status === '??' ? '새 파일' : c.status === 'D' ? '삭제' : '수정'
                        }
                      >
                        {c.status === '??' ? '+' : c.status === 'D' ? '−' : '~'}
                      </span>
                      <span className="flex-1 truncate text-subtext1">{c.path}</span>
                      <FileDiff className="h-3 w-3 shrink-0 text-overlay1" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <ArtifactPanel
          artifacts={view.artifacts}
          selectedId={selectedArtifact}
          onSelect={setSelectedArtifact}
          onCollapse={toggleArtifacts}
        />
      </aside>
      )}

      {/* ── Prompt ───────────────────────────────── */}
      {!showOverview && (
      <div className="col-start-2 row-start-3 bg-mantle p-2.5">
        {pendingPick !== undefined && (
          <div className="mb-2.5 rounded-lg bg-surface0/60 p-3">
            <div className="mb-2 text-[12px] text-subtext1">
              이 프로젝트를 어디서 실행할까요?
              <span className="ml-2 text-overlay1">한 번 정하면 기억합니다</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {claudeRunners.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void chooseRunner(r.id)}
                  className="flex items-center gap-2 rounded-md bg-surface0 px-3 py-2 text-left text-[12px] hover:bg-surface1"
                >
                  <RunnerIcon r={r} className="h-4 w-4 text-sapphire" />
                  <span>
                    <span className="block text-subtext1">{runnerLabel(r)}</span>
                    <span className="block text-[11px] text-overlay1">{r.installMethod}</span>
                  </span>
                </button>
              ))}
              {claudeRunners.length === 0 && (
                <span className="text-[12px] text-yellow">실행 가능한 CLI를 찾지 못했습니다</span>
              )}
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div
                key={a.path}
                className="group relative h-16 w-16 overflow-hidden rounded-md"
                title={a.name}
              >
                <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                <button
                  onClick={() => setAnnotating(i)}
                  className="absolute bottom-0.5 left-0.5 hidden rounded bg-crust/80 p-0.5 text-lavender group-hover:block"
                  title="주석 달기"
                >
                  <PencilLine className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-0.5 top-0.5 hidden rounded bg-crust/80 p-0.5 text-red group-hover:block"
                  title="첨부 제거"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label
            title="이미지 첨부"
            className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-surface0/60 text-subtext0 hover:bg-surface0 hover:text-text"
          >
            <ImagePlus className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void attachFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <textarea
            ref={taRef}
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={
              !active
                ? '먼저 프로젝트를 추가하세요'
                : busy
                  ? '이 세션은 실행 중 · 새 세션은 ＋ 로 시작하세요'
                  : '지시를 입력하고 Enter · Shift+Enter 줄바꿈 · 이미지는 붙여넣기/드래그'
            }
            disabled={!active || busy}
            className="flex-1 rounded-lg border border-surface1 bg-base px-3 py-2.5 text-sm leading-relaxed text-text outline-none placeholder:text-overlay1 focus:border-lavender/60 disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!active || !prompt.trim() || busy}
            title="실행"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-lavender/20 text-lavender hover:bg-lavender/30 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
          {busy && activeSession && (
            <button
              onClick={() => void window.api.stopSession(activeSession)}
              title="중지"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-red/15 text-red hover:bg-red/25"
            >
              <CircleStop className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      )}

      {confirmDrop && (
        <ConfirmDialog
          tone="danger"
          title="프로젝트를 목록에서 제거할까요?"
          description="Workspace 등록만 해제합니다. 실제 폴더와 파일은 삭제되지 않습니다. 세션 기록도 그대로 남습니다."
          detail={confirmDrop}
          confirmLabel="제거"
          onConfirm={() => void dropProject(confirmDrop)}
          onCancel={() => setConfirmDrop(undefined)}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {confirmDelSession && (
        <ConfirmDialog
          tone="danger"
          title="이 세션을 삭제할까요?"
          description={`대화 기록·승인 이력·변경 파일 기록이 모두 지워집니다. 되돌릴 수 없습니다.${
            running.some((r) => r.id === confirmDelSession.id) ? ' 실행 중이라 먼저 중지됩니다.' : ''
          }`}
          detail={confirmDelSession.title ?? ''}
          confirmLabel="삭제"
          onConfirm={() => void removeSession(confirmDelSession.id)}
          onCancel={() => setConfirmDelSession(undefined)}
        />
      )}

      {editing && (
        <AgentEditor
          agent={editing.agent}
          isNew={editing.isNew}
          onClose={() => setEditing(undefined)}
          onSaved={(a) => {
            setEditing(undefined)
            setAgentName(a.name)
            void reloadAgents(active)
          }}
          onDeleted={(name) => {
            setEditing(undefined)
            if (agentName === name) setAgentName(undefined)
            void reloadAgents(active)
          }}
        />
      )}

      {annotating !== undefined && attachments[annotating] && (
        <ImageAnnotator
          src={attachments[annotating].url}
          onCancel={() => setAnnotating(undefined)}
          onSave={(url) => void saveAnnotation(annotating, url)}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-crust/60">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-lavender bg-mantle px-8 py-6">
            <ImagePlus className="h-8 w-8 text-lavender" />
            <span className="text-sm text-text">놓으면 이미지가 첨부됩니다</span>
          </div>
        </div>
      )}
    </div>
  )
}
