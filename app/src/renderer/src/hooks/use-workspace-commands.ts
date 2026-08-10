import {
  Bot,
  Flag,
  FolderOpen,
  FolderPlus,
  LayoutDashboard,
  Loader2,
  MessageSquarePlus,
  Moon,
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

interface WorkspaceCommandOptions {
  selected?: StoredSession
  agents: AgentDef[]
  activeProjectPath?: string
  artifactsOpen: boolean
  theme: 'dark' | 'light'
  activeRunner?: DetectedRunner
  approvals: ApprovalRequest[]
  running: RunningSession[]
  projects: StoredProject[]
  sessions: StoredSession[]
  onNewSession: () => void
  onCheckpoint: (sessionId: string) => void
  onShowOverview: () => void
  onSelectAgent: (name: string) => void
  onNewAgent: (projectPath: string) => void
  onDeleteSession: (session: StoredSession) => void
  onToggleArtifacts: () => void
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
  theme,
  activeRunner,
  approvals,
  running,
  projects,
  sessions,
  onNewSession,
  onCheckpoint,
  onShowOverview,
  onSelectAgent,
  onNewAgent,
  onDeleteSession,
  onToggleArtifacts,
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
    ...sessions.map((session) => ({
      id: `ss:${session.id}`,
      group: '세션',
      label: session.title || '(제목 없음)',
      hint: timeLabel(session.startedAt),
      icon: MessageSquarePlus,
      run: () => onOpenSession(session.id),
    })),
  ]
}

function runnerLabel(runner: DetectedRunner): string {
  return runnerEnvironmentLabel(runner) + (runner.version ? ` · ${runner.version}` : '')
}
