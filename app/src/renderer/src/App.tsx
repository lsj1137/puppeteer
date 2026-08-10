import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Check,
  Brain,
  WandSparkles,
  Bot,
  KeyRound,
  Loader2,
  LayoutDashboard,
  Paperclip,
  Settings2,
} from 'lucide-react'
import CommandPalette from './components/CommandPalette'
import { emptyAgent } from './components/AgentEditor'
import Overview from './components/Overview'
import AgentsScreen from './components/AgentsScreen'
import MemoryScreen from './components/MemoryScreen'
import SkillsScreen from './components/SkillsScreen'
import type { PromptInputHandle } from './components/PromptInput'
import SessionComposer from './components/SessionComposer'
import WorkspaceLists from './components/WorkspaceLists'
import UsageSummary from './components/UsageSummary'
import ConversationEntries from './components/ConversationEntries'
import ApprovalCard from './components/ApprovalCard'
import ArtifactSidebar from './components/ArtifactSidebar'
import WorkspaceDialogs from './components/WorkspaceDialogs'
import AppOverlays from './components/AppOverlays'
import SessionHeader from './components/SessionHeader'
import { toggleTheme, useTheme } from './lib/theme'
import type {
  ApprovalDecision,
  ApprovalRequest,
  DetectedRunner,
  RunningSession,
  SessionStatus,
  AgentDef,
  ChangedFile,
  CostTotals,
  CheckpointDraft,
  RouteCandidate,
  StoredProject,
  StoredSession,
  WorktreeIntegrationMode,
} from '@shared/session'
import {
  EMPTY_SESSION_VIEW,
  clampArtifactWidth,
  splitSessionTabs,
} from './lib/session-view'
import { useSessionViews } from './hooks/use-session-views'
import { useSessionRunner } from './hooks/use-session-runner'
import { useWorkspaceNavigation } from './hooks/use-workspace-navigation'
import { useWorkspaceCommands } from './hooks/use-workspace-commands'
import { approvalNavigationPath } from './lib/navigation'
import type { AppUpdateState } from '@shared/app-update'
import puppeteerDarkIcon from './assets/icons/puppeteer-icon-128.png'
import puppeteerLightIcon from './assets/icons/puppeteer-icon-light-128.png'

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

export default function App() {
  const [runners, setRunners] = useState<DetectedRunner[]>([])
  const [projects, setProjects] = useState<StoredProject[]>([])
  const [active, setActive] = useState<string>()

  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [activeSession, setActiveSession] = useState<string>()
  const [running, setRunning] = useState<RunningSession[]>([])

  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const approvalReturnRef = useRef<{
    projectPath?: string
    sessionId?: string
    screen: 'project' | 'overview' | 'agents' | 'memory' | 'skills'
  } | undefined>(undefined)
  const [pendingPick, setPendingPick] = useState<string>()
  const [selectedArtifact, setSelectedArtifact] = useState<string>()
  const [artifactFocusRequest, setArtifactFocusRequest] = useState(0)
  const [confirmDrop, setConfirmDrop] = useState<string>()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [attachments, setAttachments] = useState<{ path: string; url: string; name: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [annotating, setAnnotating] = useState<number>()
  /** 프로젝트 화면 / 전역 화면(Overview·Agents) 전환 */
  const [screen, setScreen] = useState<'project' | 'overview' | 'agents' | 'memory' | 'skills'>('project')
  const showOverview = screen === 'overview'
  const showAgents = screen === 'agents'
  const showMemory = screen === 'memory'
  const showSkills = screen === 'skills'
  /** 프로젝트 화면이 아님 — 탭바·대화·Artifact 를 전부 감춘다 */
  const showHome = screen !== 'project'
  const [cost, setCost] = useState<CostTotals>({ today: 0, month: 0, all: 0 })
  const [now, setNow] = useState(Date.now())
  /** 대화가 위로 스크롤됐는지 — 페이드·그림자를 그때만 보인다 */
  const [scrolled, setScrolled] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [agentName, setAgentName] = useState<string>()
  const [tabMenu, setTabMenu] = useState(false)
  const [importing, setImporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateState>()
  const [checkpoint, setCheckpoint] = useState<CheckpointDraft>()
  const [worktreeOpen, setWorktreeOpen] = useState<string>()
  const [dismissedCommitNotices, setDismissedCommitNotices] = useState<Set<string>>(new Set())
  /**
   * 다음 지시를 보낼 러너. 세션마다 다를 수 있어 프로젝트 기본값과 따로 둔다.
   * 열어둔 세션이 있으면 그 세션이 쓰던 러너를 기본으로 잡는다.
   */
  const [nextRunnerId, setNextRunnerId] = useState<string>()
  const [defaultRunnerId, setDefaultRunnerId] = useState<string | undefined>(() =>
    localStorage.getItem('ws.defaultRunner') || undefined,
  )
  const [notify, setNotify] = useState(() => localStorage.getItem('ws.notify') !== 'off')
  const [worktreeIntegrationMode, setWorktreeIntegrationMode] =
    useState<WorktreeIntegrationMode>('auto')
  /** 탭바 가용 폭 — 창 크기·Artifact 폭에 따라 바뀌므로 관찰한다 */
  const [tabRoom, setTabRoom] = useState(0)
  const [confirmDelSession, setConfirmDelSession] = useState<StoredSession>()
  const [sessionDeleteError, setSessionDeleteError] = useState<string>()
  const [editing, setEditing] = useState<{ agent: AgentDef; isNew: boolean }>()
  const [artifactsOpen, setArtifactsOpen] = useState(
    () => localStorage.getItem('ws.artifacts') !== 'closed',
  )
  const [artifactW, setArtifactW] = useState(
    () => clampArtifactWidth(Number(localStorage.getItem('ws.artifactW')) || 380),
  )

  const refresh = useCallback(async (projectPath?: string) => {
    setRunning(await window.api.listRunningSessions())
    setCost(await window.api.costTotals())
    if (projectPath) setSessions(await window.api.listSessions(projectPath))
  }, [])
  const {
    views,
    addDiffArtifact,
    failSessionView,
    forgetSessionView,
    dismissWorktreeReviewNotices,
    restoreSessionView,
  } = useSessionViews(active, refresh)

  function toggleArtifacts(): void {
    setArtifactsOpen((v) => {
      localStorage.setItem('ws.artifacts', v ? 'closed' : 'open')
      return !v
    })
  }
  const theme = useTheme()

  const scrollRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<PromptInputHandle>(null)
  const focusPrompt = useCallback(() => taRef.current?.focus(), [])

  const view = (activeSession && views[activeSession]) || EMPTY_SESSION_VIEW
  const activeProject = projects.find((p) => p.path === active)
  const selected = sessions.find((s) => s.id === activeSession)
  const selectedSessionRunnerId = selected?.runnerId
  /** 지금 화면이 가리키는 러너 — 세션 것 > 사용자가 고른 것 > 프로젝트 기본값 */
  const activeRunnerId =
    nextRunnerId ?? selectedSessionRunnerId ?? activeProject?.runnerId ?? defaultRunnerId
  const activeRunner = runners.find((r) => r.id === activeRunnerId)
  /**
   * 세션이 한 번 시작되면 실행 환경을 못 바꾼다.
   * 세션 기록이 러너 홈마다 따로라(WSL ~/.claude · Windows %USERPROFILE% · Codex ~/.codex)
   * 바꾸는 순간 이어가기가 끊긴다. 바꾸려면 새 세션을 연다.
   */
  const runnerLocked = !!selected
  /** 세션을 돌릴 수 있는 러너 전체. provider 를 가리지 않는다. */
  const usableRunners = runners.filter((r) => r.available)
  /** 홈 라우터 전용 — 라우팅 프롬프트가 Claude CLI 인자로 짜여 있다 */
  const claudeRunners = runners.filter((r) => r.provider === 'claude-cli')
  const routerRunner =
    activeRunner?.provider === 'claude-cli' ? activeRunner : claudeRunners[0]
  const { visible: visibleTabs, overflow: overflowTabs } = splitSessionTabs(
    sessions,
    activeSession,
    tabRoom,
  )
  /** 적용 대상·실행 환경이 모두 맞는 것만 */
  const usableAgents = agents.filter((a) => {
    const inScope =
      !a.workspace.projects?.length || (active ? a.workspace.projects.includes(active) : true)
    const provider = activeRunner?.provider
    const okProvider =
      !a.workspace.providers?.length || !provider || a.workspace.providers.includes(provider)
    return inScope && okProvider
  })
  /** 활성 세션이 실행 중일 때만 입력을 잠근다. 다른 세션은 계속 돌아도 된다. */
  const busy = running.some((r) => r.id === activeSession)
  const { chooseRunner, startFreshSession, submit, submitToSession } = useSessionRunner({
    activeProjectPath: active,
    activeProjectRunnerId: activeProject?.runnerId,
    activeSessionId: activeSession,
    agentName,
    attachments,
    busy,
    defaultRunnerId,
    nextRunnerId,
    pendingPrompt: pendingPick,
    runners,
    selectedSession: selected,
    failSessionView,
    refresh,
    setActiveSessionId: setActiveSession,
    setAttachments,
    setNextRunnerId,
    setPendingPrompt: setPendingPick,
    setProjects,
    setSelectedArtifact,
  })
  const {
    dropProject,
    jumpTo,
    newSession,
    openSession,
    pickFolder,
    removeSession,
    selectProject,
  } = useWorkspaceNavigation({
    activeProjectPath: active,
    activeSessionId: activeSession,
    sessions,
    views,
    forgetSessionView,
    refresh,
    restoreSessionView,
    focusPrompt,
    setActiveProjectPath: setActive,
    setActiveSessionId: setActiveSession,
    setAgentName,
    setAttachments,
    setConfirmDrop,
    setConfirmDelete: setConfirmDelSession,
    setDeleteError: setSessionDeleteError,
    setNextRunnerId,
    setPendingPrompt: setPendingPick,
    setProjects,
    setScreen,
    setScrolled,
    setSelectedArtifact,
    setSessions,
  })

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
  const latestCommitNotice = [...view.entries]
    .reverse()
    .find(
      (entry) =>
        entry.kind === 'notice' &&
        (entry.title === '자동 커밋·병합 완료' || entry.title === '커밋·병합 검토 필요'),
    )
  const commitNotice = latestCommitNotice && !dismissedCommitNotices.has(latestCommitNotice.id)
    ? latestCommitNotice
    : undefined

  // ── 초기 로드 ──
  useEffect(() => {
    void window.api.detectRunners().then(setRunners)
    void window.api.listProjects().then((ps) => {
      setProjects(ps)
      if (ps[0]) void selectProject(ps[0].path)
    })
    void window.api.listOpenApprovals().then(setApprovals)
  }, [selectProject])

  // 저장된 기본값이 사라졌거나 첫 실행이면 사용 가능한 첫 환경을 기본값으로 잡는다.
  useEffect(() => {
    if (!usableRunners.length) return
    if (defaultRunnerId && usableRunners.some((r) => r.id === defaultRunnerId)) return
    const id = usableRunners[0].id
    localStorage.setItem('ws.defaultRunner', id)
    setDefaultRunnerId(id)
  }, [runners, defaultRunnerId])

  function changeDefaultRunner(runnerId: string): void {
    if (!usableRunners.some((r) => r.id === runnerId)) return
    localStorage.setItem('ws.defaultRunner', runnerId)
    setDefaultRunnerId(runnerId)
  }

  useEffect(() => {
    void window.api.appUpdateState().then(setAppUpdate)
    return window.api.onAppUpdateState(setAppUpdate)
  }, [])

  useEffect(() => {
    void window.api.worktreeIntegrationMode().then(setWorktreeIntegrationMode)
  }, [])

  function changeWorktreeIntegrationMode(mode: WorktreeIntegrationMode): void {
    setWorktreeIntegrationMode(mode)
    void window.api.setWorktreeIntegrationMode(mode)
  }

  // 한도 리셋까지 남은 시간 표시용
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (active) void refresh(active)
    else setSessions([])
  }, [active, refresh])

  const reloadAgents = useCallback(async () => {
    setAgents(await window.api.listAgents())
  }, [])

  useEffect(() => {
    void reloadAgents()
  }, [active, reloadAgents])

  useEffect(() => {
    localStorage.setItem('ws.notify', notify ? 'on' : 'off')
    void window.api.setNotifyEnabled(notify)
  }, [notify])

  useLayoutEffect(() => {
    const el = tabBarRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setTabRoom(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen])

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
    return window.api.onApprovalCleared((id) => {
      setApprovals((prev) => prev.filter((a) => a.id !== id))
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
  }, [active])

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
  }, [active])

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

  // Alt+↑/↓ 프로젝트 이동 · Alt+←/→ 현재 프로젝트의 세션 이동
  useEffect(() => {
    const onNavigate = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
      const projectDelta = event.code === 'ArrowUp' ? -1 : event.code === 'ArrowDown' ? 1 : 0
      const sessionDelta = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : 0
      if (!projectDelta && !sessionDelta) return

      if (projectDelta && projects.length > 0) {
        event.preventDefault()
        const current = projects.findIndex(({ path }) => path === active)
        const start = current >= 0 ? current : projectDelta > 0 ? -1 : 0
        const next = (start + projectDelta + projects.length) % projects.length
        const project = projects[next]
        if (project) void selectProject(project.path)
        return
      }

      if (sessionDelta && sessions.length > 0 && !showHome) {
        event.preventDefault()
        const current = sessions.findIndex(({ id }) => id === activeSession)
        const start = current >= 0 ? current : sessionDelta > 0 ? -1 : 0
        const next = (start + sessionDelta + sessions.length) % sessions.length
        const session = sessions[next]
        if (session) void openSession(session.id)
      }
    }
    // capture 단계에서 받아 입력창·오버레이의 방향키 처리보다 먼저 실행한다.
    window.addEventListener('keydown', onNavigate, true)
    return () => window.removeEventListener('keydown', onNavigate, true)
  }, [active, activeSession, openSession, projects, selectProject, sessions, showHome])

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
    const id = await addDiffArtifact(activeSession, path)
    setSelectedArtifact(id)
    setArtifactFocusRequest((request) => request + 1)
  }

  function focusArtifact(id: string): void {
    setSelectedArtifact(id)
    setArtifactsOpen(true)
    localStorage.setItem('ws.artifacts', 'open')
    setArtifactFocusRequest((request) => request + 1)
  }

  async function openApproval(approval: ApprovalRequest): Promise<void> {
    if (!approvalReturnRef.current && (approval.sessionId !== activeSession || screen !== 'project')) {
      approvalReturnRef.current = { projectPath: active, sessionId: activeSession, screen }
    }
    await jumpTo(approval.sessionId, approvalNavigationPath(approval))
  }

  async function decide(id: string, decision: ApprovalDecision): Promise<void> {
    const decidedApproval = approvals.find((approval) => approval.id === id)
    await window.api.resolveApproval(id, decision)
    const remaining = await window.api.listOpenApprovals()
    setApprovals(remaining)

    const previous = approvalReturnRef.current
    if (!previous) return
    if (decidedApproval && remaining.some((approval) => approval.sessionId === decidedApproval.sessionId)) {
      return
    }
    approvalReturnRef.current = undefined
    if (previous.sessionId && previous.projectPath) {
      await jumpTo(previous.sessionId, previous.projectPath)
    } else if (previous.projectPath) {
      await selectProject(previous.projectPath, false)
    }
    setScreen(previous.screen)
  }

  async function renameSession(sessionId: string, title: string): Promise<void> {
    const renamed = await window.api.renameSession(sessionId, title)
    if (!renamed) return
    setSessions((current) => current.map((session) => session.id === sessionId ? renamed : session))
    setRunning((current) => current.map((session) =>
      session.id === sessionId ? { ...session, title: renamed.title || title } : session,
    ))
  }

  function reorderProjects(paths: string[]): void {
    setProjects((current) => {
      const byPath = new Map(current.map((project) => [project.path, project]))
      return paths.flatMap((path) => byPath.get(path) ? [byPath.get(path)!] : [])
    })
    void window.api.reorderProjects(paths).catch(() => {
      void window.api.listProjects().then(setProjects)
    })
  }

  async function renameProject(path: string, alias: string): Promise<void> {
    const renamed = await window.api.renameProject(path, alias)
    if (!renamed) return
    setProjects((current) => current.map((project) => project.path === path ? renamed : project))
  }

  /**
   * 홈에서 라우팅한 지시를 실제로 실행한다.
   * 실행 환경은 여기서 임의로 정하지 않는다 — 프로젝트에 아직 없으면
   * 일반 세션과 똑같이 첫 지시 시점에 사용자가 고르게 한다.
   */
  async function runRouted(c: RouteCandidate, projectPath: string, text: string): Promise<void> {
    void selectProject(projectPath, false)
    setAgentName(c.agentName)

    const proj = projects.find((p) => p.path === projectPath)
    const runner = runners.find((r) => r.id === proj?.runnerId)
    if (runner) {
      await startFreshSession({
        runnerId: runner.id,
        cwd: projectPath,
        prompt: text,
        agentName: c.agentName,
      })
      return
    }
    if (usableRunners.length === 1) {
      const runnerId = usableRunners[0].id
      setNextRunnerId(runnerId)
      await window.api.setProjectRunner(projectPath, runnerId)
      setProjects(await window.api.listProjects())
      await startFreshSession({ runnerId, cwd: projectPath, prompt: text, agentName: c.agentName })
      return
    }

    // 고를 게 여럿이면 선택 UI 를 띄우고 멈춘다
    setPendingPick(text)
  }

  /**
   * 체크포인트 인계. 세션 ID 가 아니라 텍스트를 넘기므로
   * 실행 환경과 에이전트를 바꿔서 시작할 수 있다.
   */
  async function handoff(body: string, runnerId: string, agent?: string): Promise<void> {
    const path = checkpoint?.projectPath ?? active
    if (!path) return

    setCheckpoint(undefined)
    setActiveSession(undefined) // 새 세션으로 간다
    setNextRunnerId(runnerId)
    setAgentName(agent)
    await startFreshSession({ runnerId, cwd: path, prompt: body, agentName: agent })
  }

  const commands = useWorkspaceCommands({
    selected,
    agents,
    activeProjectPath: active,
    artifactsOpen,
    theme,
    activeRunner,
    approvals,
    running,
    projects,
    sessions,
    onNewSession: newSession,
    onCheckpoint: (sessionId) => {
      void window.api.buildCheckpoint(sessionId).then((draft) => draft && setCheckpoint(draft))
    },
    onShowOverview: () => setScreen('overview'),
    onSelectAgent: setAgentName,
    onNewAgent: (projectPath) => setEditing({ agent: emptyAgent(projectPath), isNew: true }),
    onDeleteSession: (session) => {
      setSessionDeleteError(undefined)
      setConfirmDelSession(session)
    },
    onToggleArtifacts: toggleArtifacts,
    onToggleTheme: toggleTheme,
    onPickFolder: () => void pickFolder(),
    onChooseRunner: () => setPendingPick(''),
    onJump: (sessionId, projectPath) => void jumpTo(sessionId, projectPath),
    onSelectProject: selectProject,
    onOpenSession: (sessionId) => void openSession(sessionId),
  })

  return (
    <div
      className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden bg-base text-text"
      style={{ gridTemplateColumns: `264px 1fr ${artifactsOpen ? artifactW : 40}px` }}
    >
      {/* ── Rail ─────────────────────────────────── */}
      <aside className="col-start-1 row-start-1 row-end-4 flex flex-col gap-3.5 overflow-auto border-r border-surface0 bg-mantle p-2.5">
        <div className="flex items-center gap-2 px-1 pt-1">
          <img
            src={theme === 'light' ? puppeteerLightIcon : puppeteerDarkIcon}
            alt=""
            className="h-6 w-6 rounded-md"
          />
          <span className="flex-1 text-sm font-semibold">Puppeteer</span>
          <button
            onClick={() => setSettingsOpen(true)}
            title="설정"
            className="relative rounded-md p-1 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <Settings2 className="h-4 w-4" />
            {(appUpdate?.phase === 'available' || appUpdate?.phase === 'downloaded') && (
              <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-mauve ring-2 ring-mantle" />
            )}
          </button>
        </div>

        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => setScreen('agents')}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              showAgents ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
            }`}
          >
            <Bot className="h-4 w-4 text-mauve" />
            Agents
            {agents.length > 0 && (
              <span className="ml-auto text-[11px] text-overlay1">{agents.length}</span>
            )}
          </button>

          <button
            onClick={() => setScreen('memory')}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              showMemory ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
            }`}
          >
            <Brain className="h-4 w-4 text-teal" />
            Memory
          </button>

          <button
            onClick={() => setScreen('skills')}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              showSkills ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
            }`}
          >
            <WandSparkles className="h-4 w-4 text-yellow" />
            Skills
          </button>

          <button
            onClick={() => setScreen('overview')}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              showOverview ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
            }`}
          >
            <LayoutDashboard className="h-4 w-4 text-sapphire" />
            Overview
          </button>
        </div>

        <WorkspaceLists
          activeProjectPath={active}
          activeSessionId={activeSession}
          approvals={approvals}
          projects={projects}
          runners={runners}
          running={running}
          onDropProject={setConfirmDrop}
          onJump={jumpTo}
          onOpenApproval={openApproval}
          onPickFolder={pickFolder}
          onRenameProject={renameProject}
          onReorderProjects={reorderProjects}
          onSelectProject={selectProject}
        />

        <UsageSummary
          cost={cost}
          limit={limit}
          sessionCost={view.cost}
          sessionTokens={view.tokens}
        />
      </aside>

      {/* ── Session Tabs ─────────────────────────── */}
      {!showHome && active && (
        <SessionHeader
          tabBarRef={tabBarRef}
          activeSessionId={activeSession}
          visibleTabs={visibleTabs}
          overflowTabs={overflowTabs}
          running={running}
          approvals={approvals}
          tabMenuOpen={tabMenu}
          onToggleTabMenu={() => setTabMenu((open) => !open)}
          onCloseTabMenu={() => setTabMenu(false)}
          onNewSession={newSession}
          onOpenSession={(sessionId) => void openSession(sessionId)}
          onRenameSession={renameSession}
          onDeleteSession={(session) => {
            setSessionDeleteError(undefined)
            setConfirmDelSession(session)
          }}
          selectedSession={selected}
          onOpenWorktree={setWorktreeOpen}
          onCheckpoint={(sessionId) => {
            void window.api.buildCheckpoint(sessionId).then((draft) => draft && setCheckpoint(draft))
          }}
        />
      )}

      {/* ── Conversation / Overview / Agents ─────── */}
      {showHome ? (
        <main className="col-start-2 col-end-4 row-start-1 row-end-4 min-h-0 overflow-hidden">
          {showSkills ? (
            <SkillsScreen projects={projects} agents={agents} />
          ) : showMemory ? (
            <MemoryScreen />
          ) : showAgents ? (
            <AgentsScreen
              agents={agents}
              projects={projects}
              runner={routerRunner}
              runnerMissingReason={
                usableRunners.length > 0
                  ? '자동 라우팅에는 Claude CLI가 필요합니다'
                  : '실행 가능한 CLI를 찾지 못했습니다'
              }
              routeCwd={active || projects[0]?.path}
              onRunAgent={runRouted}
              onEdit={(a) => setEditing({ agent: a, isNew: false })}
              onNew={() => setEditing({ agent: emptyAgent(active), isNew: true })}
              onImport={() => setImporting(true)}
              onReload={() => void reloadAgents()}
            />
          ) : (
            <Overview
              running={running}
              approvals={approvals}
              statusLabel={(st) => STATUS[st]}
              onOpenProject={selectProject}
              onOpenSession={(id, path) => void jumpTo(id, path)}
              onOpenApproval={(approval) => void openApproval(approval)}
            />
          )}
        </main>
      ) : (
      <main
        ref={scrollRef}
        onScroll={(event) => {
          const target = event.currentTarget
          setScrolled(target.scrollTop > 8)
          setShowScrollToBottom(
            target.scrollHeight - target.scrollTop - target.clientHeight > 48,
          )
        }}
        onWheel={() => window.dispatchEvent(new Event('workspace:user-interaction'))}
        onTouchMove={() => window.dispatchEvent(new Event('workspace:user-interaction'))}
        className="col-start-2 row-start-2 flex min-w-0 flex-col overflow-y-auto overflow-x-hidden px-5 py-4 [overflow-wrap:anywhere]"
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
          <ConversationEntries
            view={view}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={focusArtifact}
            onOpenMemory={() => setScreen('memory')}
          />

          {busy && (
            <div className="flex items-center gap-2 px-0.5 text-[12px] text-subtext0">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky" />
              {view.status ? STATUS[view.status].label : '시작 중'}
            </div>
          )}

          {myApprovals.map((approval, index) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              shortcutsActive={index === myApprovals.length - 1}
              onDecide={decide}
            />
          ))}

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

      {!showHome && showScrollToBottom && (
        <button
          type="button"
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
          }}
          title="대화 맨 아래로"
          aria-label="대화 맨 아래로"
          className="col-start-2 row-start-2 z-20 mb-3 mr-3 flex h-8 w-8 self-end justify-self-end items-center justify-center rounded-full border border-surface1 bg-mantle/95 text-subtext0 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-surface0 hover:text-text"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      {/* ── Artifacts ────────────────────────────── */}
      {!showHome && (
        <ArtifactSidebar
          open={artifactsOpen}
          width={artifactW}
          setWidth={setArtifactW}
          view={view}
          changes={changes}
          selectedId={selectedArtifact}
          focusArtifactRequest={artifactFocusRequest}
          onSelect={setSelectedArtifact}
          onOpenDiff={openDiff}
          sessionId={selected?.id}
          worktree={selected?.worktree}
          onManageWorktree={() => {
            if (selected?.worktree) setWorktreeOpen(selected.id)
          }}
          onToggle={toggleArtifacts}
          rootPath={selected?.worktree?.path ?? active}
        />
      )}

      {/* ── Prompt ───────────────────────────────── */}
      {!showHome && (
        <SessionComposer
          ref={taRef}
          active={Boolean(active)}
          activeSessionId={activeSession}
          attachments={attachments}
          busy={busy}
          historyKey={active ?? 'workspace'}
          promptHistory={view.entries
            .filter((entry) => entry.kind === 'user')
            .map((entry) => entry.text)}
          runningSessionIds={running.map(({ id }) => id)}
          runners={usableRunners}
          showRunnerPicker={pendingPick !== undefined && !runnerLocked}
          activeRunner={activeRunner}
          runnerLocked={runnerLocked}
          agentName={agentName}
          agents={usableAgents}
          commitNotice={
            commitNotice?.kind === 'notice'
              ? {
                  id: commitNotice.id,
                  title: commitNotice.title,
                  text: commitNotice.text,
                  status: commitNotice.title === '자동 커밋·병합 완료' ? 'success' : 'warning',
                }
              : undefined
          }
          onAnnotate={setAnnotating}
          onAttachFiles={attachFiles}
          onChooseRunner={chooseRunner}
          onSelectAgent={(name) => {
            setAgentName(name)
          }}
          onEditAgent={(agent) => {
            setEditing({ agent, isNew: false })
          }}
          onNewAgent={() => {
            setEditing({ agent: emptyAgent(active), isNew: true })
          }}
          onRemoveAttachment={(index) =>
            setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
          }
          onStop={(sessionId) => window.api.stopSession(sessionId)}
          onSubmit={submit}
          onSubmitToSession={submitToSession}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      <WorkspaceDialogs
        confirmDrop={confirmDrop}
        onConfirmDrop={(projectPath) => void dropProject(projectPath)}
        onCancelDrop={() => setConfirmDrop(undefined)}
        confirmDelete={confirmDelSession}
        deleteError={sessionDeleteError}
        running={running}
        onConfirmDelete={(sessionId) => void removeSession(sessionId)}
        onCancelDelete={() => {
          setSessionDeleteError(undefined)
          setConfirmDelSession(undefined)
        }}
        checkpoint={checkpoint}
        runners={usableRunners}
        agents={agents}
        onCloseCheckpoint={() => setCheckpoint(undefined)}
        onHandoff={(body, runnerId, nextAgentName) =>
          void handoff(body, runnerId, nextAgentName)
        }
        worktreeSession={
          worktreeOpen && selected?.id === worktreeOpen && selected.worktree ? selected : undefined
        }
        onWorktreeChanged={() => {
          if (commitNotice?.kind === 'notice' && commitNotice.title === '커밋·병합 검토 필요') {
            setDismissedCommitNotices((current) => new Set(current).add(commitNotice.id))
            if (activeSession) dismissWorktreeReviewNotices(activeSession)
          }
          void refresh(active)
        }}
        onCloseWorktree={() => setWorktreeOpen(undefined)}
      />

      <AppOverlays
        settingsOpen={settingsOpen}
        theme={theme}
        notify={notify}
        runners={usableRunners}
        defaultRunnerId={defaultRunnerId}
        worktreeIntegrationMode={worktreeIntegrationMode}
        appUpdate={appUpdate}
        hasRunningSessions={running.length > 0}
        onToggleTheme={toggleTheme}
        onToggleNotify={setNotify}
        onDefaultRunnerChange={changeDefaultRunner}
        onWorktreeIntegrationModeChange={changeWorktreeIntegrationMode}
        onCloseSettings={() => setSettingsOpen(false)}
        importing={importing}
        projects={projects}
        agents={agents}
        onCloseImport={() => setImporting(false)}
        onImported={() => {
          setImporting(false)
          void reloadAgents()
        }}
        editing={editing}
        onCloseEditor={() => setEditing(undefined)}
        onAgentSaved={(savedAgent) => {
          setEditing(undefined)
          setAgentName(savedAgent.name)
          void reloadAgents()
        }}
        onAgentDeleted={(name) => {
          setEditing(undefined)
          if (agentName === name) setAgentName(undefined)
          void reloadAgents()
        }}
        annotating={annotating}
        attachments={attachments}
        onCancelAnnotation={() => setAnnotating(undefined)}
        onSaveAnnotation={(index, url) => void saveAnnotation(index, url)}
        dragOver={dragOver}
      />
    </div>
  )
}
