import {
  Bot,
  Flag,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  Loader2,
  MessageSquarePlus,
  Moon,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  ShieldAlert,
  Sun,
  Terminal,
  Trash2,
} from 'lucide-react'
import type {
  AgentDef,
  ApprovalRequest,
  DetectedRunner,
  RunningSession,
  StoredProject,
  StoredSession,
} from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import type { Command } from '../components/CommandPalette'
import { approvalNavigationPath } from '../lib/navigation'
import { baseName, timeLabel } from '../lib/session-view'
import { orderForSearch, searchHint } from '../lib/session-search'

interface WorkspaceCommandOptions {
  selected?: StoredSession
  agents: AgentDef[]
  activeProjectPath?: string
  artifactsOpen: boolean
  railOpen: boolean
  theme: 'dark' | 'light'
  activeRunner?: DetectedRunner
  approvals: ApprovalRequest[]
  running: RunningSession[]
  projects: StoredProject[]
  sessions: StoredSession[]
  /**
   * 팔레트를 열 때 받아 온 모든 프로젝트의 세션(숨긴 것 포함). 있으면 세션 검색은 이걸로 한다.
   * 예전엔 지금 프로젝트의 보이는 세션만 찾을 수 있었다.
   */
  searchSessions?: StoredSession[]
  onOpenFoundSession?: (session: StoredSession) => void
  onNewSession: () => void
  onCheckpoint: (sessionId: string) => void
  onShowOverview: () => void
  onSelectAgent: (name: string) => void
  onNewAgent: (projectPath: string) => void
  onDeleteSession: (session: StoredSession) => void
  onToggleArtifacts: () => void
  onToggleRail: () => void
  onToggleTheme: () => void
  onPickFolder: () => void
  onChooseRunner: () => void
  onJump: (sessionId: string, projectPath: string) => void
  onSelectProject: (projectPath: string) => void
  onOpenSession: (sessionId: string) => void
}

/** 현재 workspace 상태에서 명령 팔레트 항목을 만든다. */
export function useWorkspaceCommands({
  selected,
  agents,
  activeProjectPath,
  artifactsOpen,
  railOpen,
  theme,
  activeRunner,
  approvals,
  running,
  projects,
  sessions,
  searchSessions,
  onOpenFoundSession,
  onNewSession,
  onCheckpoint,
  onShowOverview,
  onSelectAgent,
  onNewAgent,
  onDeleteSession,
  onToggleArtifacts,
  onToggleRail,
  onToggleTheme,
  onPickFolder,
  onChooseRunner,
  onJump,
  onSelectProject,
  onOpenSession,
}: WorkspaceCommandOptions): Command[] {
  return [
    { id: 'act:new', group: '명령', label: '새 세션', icon: MessageSquarePlus, run: onNewSession },
    ...(selected
      ? [{ id: 'act:checkpoint', group: '명령', label: '체크포인트로 인계', icon: Flag, run: () => onCheckpoint(selected.id) }]
      : []),
    { id: 'act:overview', group: '명령', label: 'Overview 열기', icon: LayoutDashboard, run: onShowOverview },
    ...agents.map((agent) => ({
      id: `ag:${agent.name}`,
      group: '에이전트',
      label: `${agent.name} 로 실행`,
      hint: agent.description,
      icon: Bot,
      run: () => onSelectAgent(agent.name),
    })),
    ...(activeProjectPath
      ? [{ id: 'act:agent-new', group: '명령', label: '새 에이전트 만들기', icon: Plus, run: () => onNewAgent(activeProjectPath) }]
      : []),
    ...(selected
      ? [{ id: 'act:session-del', group: '명령', label: '현재 세션 삭제', hint: selected.title ?? '', icon: Trash2, run: () => onDeleteSession(selected) }]
      : []),
    {
      id: 'act:artifacts',
      group: '명령',
      label: artifactsOpen ? 'Artifacts 패널 접기' : 'Artifacts 패널 펼치기',
      icon: PanelRightOpen,
      run: onToggleArtifacts,
    },
    {
      id: 'act:rail',
      group: '명령',
      label: railOpen ? '사이드바 접기' : '사이드바 펼치기',
      hint: 'Ctrl+B',
      icon: PanelLeftOpen,
      run: onToggleRail,
    },
    {
      id: 'act:theme',
      group: '명령',
      label: theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환',
      icon: theme === 'dark' ? Sun : Moon,
      run: onToggleTheme,
    },
    { id: 'act:add', group: '명령', label: '프로젝트 폴더 추가', icon: FolderPlus, run: onPickFolder },
    ...(activeProjectPath
      ? [
          {
            id: 'act:reveal',
            group: '명령',
            label: '탐색기에서 프로젝트 열기',
            hint: baseName(activeProjectPath),
            icon: FolderOpen,
            run: () => void window.api.revealProject(activeProjectPath),
          },
          {
            id: 'act:runner',
            group: '명령',
            label: '실행 환경 변경',
            hint: activeRunner ? runnerLabel(activeRunner) : '미지정',
            icon: Terminal,
            run: onChooseRunner,
          },
        ]
      : []),
    ...approvals.map((approval) => ({
      id: `ap:${approval.id}`,
      group: '승인 대기',
      label: `${approval.tool} 승인 요청`,
      hint: baseName(approvalNavigationPath(approval)),
      icon: ShieldAlert,
      run: () => onJump(approval.sessionId, approvalNavigationPath(approval)),
    })),
    ...running.map((session) => ({
      id: `run:${session.id}`,
      group: '실행 중',
      label: session.title,
      hint: baseName(session.projectPath),
      icon: Loader2,
      run: () => onJump(session.id, session.projectPath),
    })),
    ...projects.map((project) => ({
      id: `pj:${project.path}`,
      group: '프로젝트',
      label: project.alias || baseName(project.path),
      hint: project.path,
      icon: FolderOpen,
      run: () => onSelectProject(project.path),
    })),
    ...(searchSessions && onOpenFoundSession
      ? orderForSearch(searchSessions, activeProjectPath).map((session) => ({
          id: `ss:${session.id}`,
          group: '세션',
          label: session.title || '(제목 없음)',
          hint: searchHint(session, projects, activeProjectPath, timeLabel(session.startedAt)),
          icon: MessageSquarePlus,
          run: () => onOpenFoundSession(session),
        }))
      : sessions.map((session) => ({
          id: `ss:${session.id}`,
          group: '세션',
          label: session.title || '(제목 없음)',
          hint: timeLabel(session.startedAt),
          icon: MessageSquarePlus,
          run: () => onOpenSession(session.id),
        }))),
  ]
}

function runnerLabel(runner: DetectedRunner): string {
  return runnerEnvironmentLabel(runner) + (runner.version ? ` · ${runner.version}` : '')
}
