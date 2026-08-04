import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileDiff,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type {
  SessionWorktree,
  WorktreeRebaseStrategy,
  WorktreeStatus,
} from '@shared/session'
import Code from './Code'
import { shouldShowWorktreeRebase } from '../lib/worktree'
import { generateCommitMessage } from '../lib/commit-message'

interface Props {
  sessionId: string
  worktree: SessionWorktree
  onChanged: () => void | Promise<void>
  onClose: () => void
}

export default function WorktreeDialog({ sessionId, worktree, onChanged, onClose }: Props) {
  const [status, setStatus] = useState<WorktreeStatus>()
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [rebasing, setRebasing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [commitMessage, setCommitMessage] = useState('')
  const [generatingMessage, setGeneratingMessage] = useState(false)
  const commitMessageEdited = useRef(false)
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [diff, setDiff] = useState<string>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const reload = useCallback(async (): Promise<WorktreeStatus | undefined> => {
    setLoading(true)
    try {
      const next = await window.api.worktreeStatus(sessionId)
      setStatus(next)
      setConflictFiles(next?.conflictFiles ?? [])
      if (!next) setMessage({ ok: false, text: '연결된 worktree 정보를 찾지 못했습니다.' })
      return next
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 상태를 읽지 못했습니다.',
      })
      return undefined
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    commitMessageEdited.current = false
    setCommitMessage('')
  }, [sessionId])

  const generateMessage = useCallback(async (force = false): Promise<void> => {
    if (commitMessageEdited.current && !force) return
    setGeneratingMessage(true)
    try {
      const next = generateCommitMessage(await window.api.worktreeDiff(sessionId)).value
      if (!commitMessageEdited.current || force) {
        setCommitMessage(next)
        if (force) commitMessageEdited.current = false
      }
    } finally {
      setGeneratingMessage(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (status?.dirty) void generateMessage()
  }, [generateMessage, status?.dirty])

  useEffect(() => {
    return window.api.onWorktreeResolved((resolvedSessionId) => {
      if (resolvedSessionId !== sessionId) return
      void (async () => {
        const next = await reload()
        if (!next) return
        setMessage({
          ok: true,
          text: next.canMerge
            ? '충돌 해결이 완료되었습니다. 이제 원본 브랜치에 병합할 수 있습니다.'
            : '충돌 해결이 완료되어 worktree 상태를 갱신했습니다.',
        })
        await onChanged()
        if (diff !== undefined) setDiff(await window.api.worktreeDiff(sessionId))
      })()
    })
  }, [diff, onChanged, reload, sessionId])

  useEffect(() => {
    return window.api.onWorktreeRebaseAborted((abortedSessionId) => {
      if (abortedSessionId !== sessionId) return
      void (async () => {
        await reload()
        setMessage({ ok: false, text: '충돌 해결을 취소해 worktree를 이전 상태로 되돌렸습니다.' })
      })()
    })
  }, [reload, sessionId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !committing && !rebasing && !merging && !dropping) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [committing, dropping, merging, onClose, rebasing])

  async function commit(): Promise<void> {
    setCommitting(true)
    setMessage(undefined)
    try {
      const result = await window.api.commitWorktree(sessionId, commitMessage)
      if (result.status) setStatus(result.status)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        setConflictFiles([])
        await onChanged()
        if (diff !== undefined) setDiff(await window.api.worktreeDiff(sessionId))
      }
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 커밋 요청에 실패했습니다.',
      })
    } finally {
      setCommitting(false)
    }
  }

  async function openConflictResolver(files = conflictFiles): Promise<void> {
    if (files.length === 0) return
    await window.api.openWorktreeConflictResolver(sessionId, files)
  }

  async function merge(): Promise<void> {
    setMerging(true)
    setMessage(undefined)
    try {
      const result = await window.api.mergeWorktree(sessionId)
      if (result.status) setStatus(result.status)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        setConflictFiles([])
        await onChanged()
      }
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 병합 요청에 실패했습니다.',
      })
    } finally {
      setMerging(false)
    }
  }

  async function rebase(strategy?: WorktreeRebaseStrategy): Promise<void> {
    setRebasing(true)
    setMessage(undefined)
    try {
      const result = await window.api.rebaseWorktree(sessionId, strategy)
      if (result.status) setStatus(result.status)
      setMessage({ ok: result.ok, text: result.message })
      setConflictFiles(result.conflictFiles ?? [])
      if (!result.ok && result.conflictFiles?.[0]) {
        await openConflictResolver(result.conflictFiles)
      }
      if (result.ok) {
        setConflictFiles([])
        await onChanged()
        if (diff !== undefined) setDiff(await window.api.worktreeDiff(sessionId))
      }
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : '원본 변경 반영 요청에 실패했습니다.',
      })
    } finally {
      setRebasing(false)
    }
  }

  async function drop(): Promise<void> {
    setDropping(true)
    setMessage(undefined)
    try {
      const result = await window.api.dropWorktree(sessionId, false)
      if (!result.ok) {
        setMessage({
          ok: false,
          text: result.message,
        })
        await reload()
        return
      }
      await onChanged()
      onClose()
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 정리에 실패했습니다.',
      })
    } finally {
      setDropping(false)
    }
  }

  async function openDiff(): Promise<void> {
    setDiffLoading(true)
    setCopied(false)
    try {
      setDiff(await window.api.worktreeDiff(sessionId))
    } catch (error) {
      setDiff(error instanceof Error ? error.message : 'worktree diff 를 읽지 못했습니다.')
    } finally {
      setDiffLoading(false)
    }
  }

  const baseBranch = status?.baseBranch ?? worktree.baseBranch
  const hasCommits = Boolean(status?.hasCommits)
  const merged = Boolean(status?.merged)
  const hasDirtyWork = Boolean(status?.dirty)
  const hasConflict = conflictFiles.length > 0
  const running = status?.reason?.startsWith('세션이 실행 중') ?? false
  const canCommit = Boolean(status && hasDirtyWork && !hasConflict && !running && commitMessage.trim())
  const canRebase = shouldShowWorktreeRebase(status, hasConflict, running)
  const canDrop = Boolean(status && !hasDirtyWork && (merged || !hasCommits))
  const busy = committing || rebasing || merging || dropping
  const commitLabel = loading
    ? '확인 중...'
    : hasDirtyWork
      ? '커밋되지 않은 변경 있음'
      : merged
        ? '원본에 반영됨'
        : !hasCommits
          ? '반영할 커밋 없음'
          : `원본보다 ${status?.ahead ?? 0}개 앞섬`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-crust/70 p-6"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-auto rounded-lg border border-surface1 bg-mantle shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-surface0 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal/15 text-teal">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text">Worktree 관리</div>
            <div className="mt-1 truncate font-mono text-[11px] text-subtext0">{worktree.branch}</div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            title="닫기"
            className="flex h-7 w-7 items-center justify-center rounded-md text-overlay1 hover:bg-surface0 hover:text-text disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
            <span className="text-overlay1">작업 브랜치</span>
            <span className="truncate font-mono text-subtext1">{worktree.branch}</span>
            <span className="text-overlay1">원본 브랜치</span>
            <span className="truncate font-mono text-subtext1">{baseBranch ?? '확인 불가'}</span>
            <span className="text-overlay1">현재 원본 브랜치</span>
            <span className="truncate font-mono text-subtext1">
              {loading ? '확인 중...' : (status?.currentBranch ?? '확인 불가')}
            </span>
            <span className="text-overlay1">커밋 상태</span>
            <span className="text-subtext1">{commitLabel}</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void openDiff()}
              disabled={diffLoading}
              className="flex items-center gap-1.5 rounded-md border border-peach/30 bg-peach/10 px-2.5 py-1.5 text-[12px] font-medium text-peach hover:bg-peach/20 disabled:opacity-40"
            >
              {diffLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDiff className="h-3.5 w-3.5" />
              )}
              Diff 보기
            </button>
            <button
              onClick={() => void window.api.revealProject(worktree.origin)}
              className="flex items-center gap-1.5 rounded-md border border-surface1 px-2.5 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
            >
              <FolderOpen className="h-3.5 w-3.5" /> 원본 폴더
            </button>
            <button
              onClick={() => void window.api.revealProject(worktree.path)}
              className="flex items-center gap-1.5 rounded-md border border-surface1 px-2.5 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Worktree 폴더
            </button>
            <button
              onClick={() => void reload()}
              disabled={loading || busy}
              title="상태 새로고침"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-overlay1 hover:bg-surface0 hover:text-text disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {!loading && merged && (
            <div className="flex gap-2 rounded-md border border-green/30 bg-green/5 px-3 py-2.5 text-[12px] text-green">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 leading-relaxed">
                <div>원본 브랜치에 커밋이 반영되었습니다.</div>
                <div className="mt-1 text-green/80">
                  worktree 정리 시 병합됐거나 커밋이 없는 작업 브랜치는 함께 삭제합니다. 미병합
                  커밋이 있는 브랜치는 작업 보호를 위해 남겨 둡니다.
                </div>
              </div>
            </div>
          )}

          {!loading && status && !hasDirtyWork && !hasCommits && (
            <div className="flex gap-2 rounded-md border border-surface1 bg-surface0/40 px-3 py-2.5 text-[12px] text-subtext1">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-overlay1" />
              <span className="leading-relaxed">아직 이 worktree에서 커밋된 변경이 없습니다.</span>
            </div>
          )}

          {!loading && status?.reason && !merged && (hasCommits || hasDirtyWork || status.originDirty) && (
            <div className="flex gap-2 rounded-md border border-yellow/30 bg-yellow/5 px-3 py-2.5 text-[12px] text-yellow">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="leading-relaxed">{status.reason}</span>
            </div>
          )}

          {!loading && canRebase && (
            <div className="-mx-5 border-y border-surface0 bg-base/35 px-5 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-mauve/15 text-mauve">
                    <GitPullRequestArrow className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-text">원본 변경 반영</div>
                    <div className="truncate text-[11px] text-overlay1">
                      원본보다 {status?.behind ?? 0}개 뒤처짐
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => void rebase()}
                  disabled={!canRebase || busy}
                  className="flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-mauve px-3 py-1.5 text-[12px] font-semibold text-crust hover:bg-pink disabled:cursor-not-allowed disabled:bg-surface1 disabled:text-overlay1"
                >
                  {rebasing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitPullRequestArrow className="h-3.5 w-3.5" />
                  )}
                  반영
                </button>
              </div>
            </div>
          )}

          {!loading && conflictFiles.length > 0 && (
            <div className="rounded-md border border-yellow/20 bg-yellow/5 p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-[11px] font-semibold text-yellow">충돌 파일</div>
                <span className="rounded bg-yellow/10 px-1.5 py-0.5 text-[10px] text-yellow">
                  {conflictFiles.length}개
                </span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {conflictFiles.map((path) => (
                  <span
                    key={path}
                    className="rounded bg-surface0 px-1.5 py-0.5 font-mono text-[11px] text-subtext1"
                  >
                    {path}
                  </span>
                ))}
              </div>
              <button
                onClick={() => void openConflictResolver()}
                className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md bg-yellow/15 px-3 py-1.5 text-[12px] font-semibold text-yellow hover:bg-yellow/25"
              >
                <GitPullRequestArrow className="h-3.5 w-3.5" />
                충돌 해결 창 열기
              </button>
            </div>
          )}

          {!loading && hasDirtyWork && !hasConflict && (
            <div className="-mx-5 border-y border-surface0 bg-base/35 px-5 py-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue/15 text-blue">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                </span>
                <span className="text-[12px] font-semibold text-text">변경 커밋</span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${
                    commitMessage.trim()
                      ? 'bg-blue/15 text-blue'
                      : 'bg-yellow/10 text-yellow'
                  }`}
                >
                  {commitMessage.trim() ? '준비됨' : '메시지 필요'}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="min-w-0 flex-1 rounded-md border border-surface1 bg-mantle px-2.5 py-1.5 focus-within:border-blue">
                  <textarea
                    rows={4}
                    value={commitMessage}
                    onChange={(event) => {
                      commitMessageEdited.current = true
                      setCommitMessage(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit && !busy) {
                        event.preventDefault()
                        void commit()
                      }
                    }}
                    disabled={busy || running}
                    placeholder={generatingMessage ? '변경 내용 분석 중...' : '커밋 메시지'}
                    className="w-full resize-y bg-transparent font-mono text-[12px] leading-relaxed text-text outline-none placeholder:text-overlay0 disabled:opacity-50"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => void generateMessage(true)}
                    disabled={busy || generatingMessage}
                    className="flex min-h-8 items-center gap-1.5 rounded-md border border-surface1 px-2.5 py-1.5 text-[11px] text-subtext1 hover:bg-surface0 disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${generatingMessage ? 'animate-spin' : ''}`} />
                    다시 생성
                  </button>
                  <button
                    onClick={() => void commit()}
                    disabled={!canCommit || busy || generatingMessage}
                    className="flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-blue px-3 py-1.5 text-[12px] font-semibold text-crust hover:bg-sky disabled:cursor-not-allowed disabled:bg-surface1 disabled:text-overlay1"
                  >
                    {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />}
                    커밋
                  </button>
                </div>
              </div>
            </div>
          )}

          {message && (
            <div
              className={`flex gap-2 rounded-md border px-3 py-2.5 text-[12px] ${
                message.ok
                  ? 'border-green/30 bg-green/5 text-green'
                  : 'border-red/30 bg-red/5 text-red'
              }`}
            >
              {message.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="leading-relaxed">{message.text}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-surface0 px-5 py-4">
          <span className="text-[11px] text-overlay1">
            {merged
              ? 'worktree 폴더 정리는 세션 기록을 보존합니다.'
              : !hasCommits
                ? '반영할 커밋이 없으면 worktree만 정리할 수 있습니다.'
              : '병합 후에도 worktree와 작업 브랜치는 유지됩니다.'}
          </span>
          {canDrop ? (
            <button
              onClick={() => void drop()}
              disabled={loading || dropping || status?.dirty}
              className="flex min-w-[112px] items-center justify-center gap-1.5 rounded-md bg-green/20 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {dropping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Worktree 정리
            </button>
          ) : (
            <button
              onClick={() => void merge()}
              disabled={!status?.canMerge || merging || loading}
              className="flex min-w-[112px] items-center justify-center gap-1.5 rounded-md bg-teal/20 px-3 py-1.5 text-[12px] font-medium text-teal hover:bg-teal/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {merging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5" />
              )}
              원본에 병합
            </button>
          )}
        </div>
      </div>

      {diff !== undefined && (
        <div className="fixed inset-6 z-[60] flex min-h-0 flex-col rounded-lg border border-surface1 bg-mantle shadow-2xl">
          <div className="flex items-center gap-2 border-b border-surface0 px-4 py-3">
            <FileDiff className="h-4 w-4 shrink-0 text-peach" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text">Worktree diff</div>
              <div className="truncate font-mono text-[11px] text-subtext0">
                {worktree.baseHead?.slice(0, 12) ?? 'base'}..{worktree.branch}
              </div>
            </div>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(diff)
                setCopied(true)
              }}
              title="복사"
              className="flex h-8 w-8 items-center justify-center rounded-md text-overlay1 hover:bg-surface0 hover:text-text"
            >
              {copied ? <Check className="h-4 w-4 text-green" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setDiff(undefined)}
              title="닫기"
              className="flex h-8 w-8 items-center justify-center rounded-md text-overlay1 hover:bg-surface0 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <Code code={diff} language="diff" lineNumbers />
          </div>
        </div>
      )}
    </div>
  )
}
