import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileDiff,
  FolderOpen,
  GitBranch,
  GitMerge,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { SessionWorktree, WorktreeStatus } from '@shared/session'
import Code from './Code'

interface Props {
  sessionId: string
  worktree: SessionWorktree
  onChanged: () => void | Promise<void>
  onClose: () => void
}

export default function WorktreeDialog({ sessionId, worktree, onChanged, onClose }: Props) {
  const [status, setStatus] = useState<WorktreeStatus>()
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [diff, setDiff] = useState<string>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.worktreeStatus(sessionId)
      setStatus(next)
      if (!next) setMessage({ ok: false, text: '연결된 worktree 정보를 찾지 못했습니다.' })
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 상태를 읽지 못했습니다.',
      })
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !merging && !dropping) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dropping, merging, onClose])

  async function merge(): Promise<void> {
    setMerging(true)
    setMessage(undefined)
    try {
      const result = await window.api.mergeWorktree(sessionId)
      if (result.status) setStatus(result.status)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) await onChanged()
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : 'worktree 병합 요청에 실패했습니다.',
      })
    } finally {
      setMerging(false)
    }
  }

  async function drop(): Promise<void> {
    setDropping(true)
    setMessage(undefined)
    try {
      const ok = await window.api.dropWorktree(sessionId, false)
      if (!ok) {
        setMessage({
          ok: false,
          text: 'worktree를 정리하지 못했습니다. 커밋되지 않은 변경이 남아 있는지 확인해 주세요.',
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
  const canDrop = Boolean(status && !hasDirtyWork && (merged || !hasCommits))
  const busy = merging || dropping
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
        className="w-full max-w-lg rounded-lg border border-surface1 bg-mantle shadow-2xl"
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
                  worktree 정리 후 작업 브랜치가 필요 없으면 터미널에서{' '}
                  <span className="font-mono">git branch -d {worktree.branch}</span>
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

          {message && (
            <div
              className={`rounded-md border px-3 py-2.5 text-[12px] ${
                message.ok
                  ? 'border-green/30 bg-green/5 text-green'
                  : 'border-red/30 bg-red/5 text-red'
              }`}
            >
              {message.text}
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
