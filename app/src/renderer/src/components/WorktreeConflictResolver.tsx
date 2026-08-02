import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileCode2, GitPullRequestArrow, Loader2, X } from 'lucide-react'
import type {
  WorktreeConflictFile,
  WorktreeConflictResolverRequest,
  WorktreeRebaseResult,
} from '@shared/session'

type Side = 'origin' | 'worktree'
type DiffBlock =
  | { kind: 'same'; originStart: number; worktreeStart: number; lines: string[] }
  | {
      kind: 'change'
      id: string
      originStart: number
      worktreeStart: number
      originLines: string[]
      worktreeLines: string[]
    }

const EMPTY: WorktreeConflictFile = {
  path: '',
  originLabel: '',
  worktreeLabel: '',
  originContent: '',
  worktreeContent: '',
  originMissing: false,
  worktreeMissing: false,
}

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffBlocks(originText: string, worktreeText: string): DiffBlock[] {
  const a = splitLines(originText)
  const b = splitLines(worktreeText)
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const blocks: DiffBlock[] = []
  let i = 0
  let j = 0
  let change = 0
  const pushSame = (line: string, originLine: number, worktreeLine: number): void => {
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'same') last.lines.push(line)
    else blocks.push({ kind: 'same', originStart: originLine, worktreeStart: worktreeLine, lines: [line] })
  }
  const pushChange = (
    originLines: string[],
    worktreeLines: string[],
    originStart: number,
    worktreeStart: number,
  ): void => {
    blocks.push({
      kind: 'change',
      id: `c${change++}`,
      originStart,
      worktreeStart,
      originLines,
      worktreeLines,
    })
  }

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      pushSame(a[i], i + 1, j + 1)
      i += 1
      j += 1
      continue
    }
    const originStart = i + 1
    const worktreeStart = j + 1
    const originLines: string[] = []
    const worktreeLines: string[] = []
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) break
      if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) {
        originLines.push(a[i])
        i += 1
      } else {
        worktreeLines.push(b[j])
        j += 1
      }
    }
    pushChange(originLines, worktreeLines, originStart, worktreeStart)
  }

  return blocks
}

function buildResolved(blocks: DiffBlock[], choices: Record<string, Side>): string {
  const lines = blocks.flatMap((block) => {
    if (block.kind === 'same') return block.lines
    return choices[block.id] === 'origin' ? block.originLines : block.worktreeLines
  })
  return `${lines.join('\n')}\n`
}

function codeRows(lines: string[], start: number) {
  if (lines.length === 0) {
    return [
      <div key="empty" className="px-2 py-1 text-[12px] text-overlay1">
        변경 없음
      </div>,
    ]
  }
  return lines.map((line, index) => (
    <div key={`${index}:${line}`} className="grid grid-cols-[48px_minmax(0,1fr)] font-mono text-[12px] leading-5">
      <span className="select-none border-r border-surface0 pr-2 text-right text-overlay1">
        {start + index}
      </span>
      <span className="whitespace-pre px-2 text-subtext1">{line || ' '}</span>
    </div>
  ))
}

function lineRange(start: number, count: number): string {
  if (count <= 0) return '-'
  if (count === 1) return `${start}`
  return `${start}-${start + count - 1}`
}

export default function WorktreeConflictResolver() {
  const token = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('token') ?? ''
  const [request, setRequest] = useState<WorktreeConflictResolverRequest>()
  const [selectedPath, setSelectedPath] = useState('')
  const [file, setFile] = useState<WorktreeConflictFile>(EMPTY)
  const [choicesByFile, setChoicesByFile] = useState<Record<string, Record<string, Side>>>({})
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  useEffect(() => {
    void window.api.conflictResolverRequest(token).then((next) => {
      setRequest(next)
      setSelectedPath(next?.files[0] ?? '')
    })
  }, [token])

  useEffect(() => {
    if (!request || !selectedPath) return
    setLoading(true)
    void window.api
      .worktreeConflictFile(request.sessionId, selectedPath)
      .then((next) => setFile(next ?? EMPTY))
      .finally(() => setLoading(false))
  }, [request, selectedPath])

  const blocks = useMemo(
    () => diffBlocks(file.originContent, file.worktreeContent),
    [file.originContent, file.worktreeContent],
  )
  const choices = choicesByFile[file.path] ?? {}
  const changed = useMemo(
    () => blocks.filter((block): block is Extract<DiffBlock, { kind: 'change' }> => block.kind === 'change'),
    [blocks],
  )
  const selectedCount = changed.filter((block) => choices[block.id]).length

  useEffect(() => {
    if (!file.path || changed.length === 0) return
    setChoicesByFile((prev) => {
      let dirty = false
      const current = prev[file.path] ?? {}
      const next = { ...current }
      for (const block of changed) {
        if (!next[block.id]) {
          next[block.id] = 'worktree'
          dirty = true
        }
      }
      if (!dirty) return prev
      return { ...prev, [file.path]: next }
    })
  }, [changed, file.path])

  function choose(blockId: string, side: Side): void {
    setChoicesByFile((prev) => ({
      ...prev,
      [file.path]: { ...(prev[file.path] ?? {}), [blockId]: side },
    }))
  }

  async function apply(): Promise<void> {
    if (!request) return
    setApplying(true)
    setMessage(undefined)
    try {
      const resolved = await Promise.all(
        request.files.map(async (path) => {
          const conflict = path === file.path ? file : await window.api.worktreeConflictFile(request.sessionId, path)
          const target = conflict ?? EMPTY
          const targetBlocks = diffBlocks(target.originContent, target.worktreeContent)
          return {
            path,
            content: buildResolved(targetBlocks, choicesByFile[path] ?? {}),
          }
        }),
      )
      const result: WorktreeRebaseResult = await window.api.resolveWorktreeConflicts(request.sessionId, resolved)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) window.setTimeout(() => window.close(), 900)
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '충돌 해결 적용 실패' })
    } finally {
      setApplying(false)
    }
  }

  if (!request) {
    return (
      <div className="flex h-screen items-center justify-center bg-base text-subtext1">
        충돌 정보를 찾지 못했습니다
      </div>
    )
  }

  return (
    <div className="grid h-screen grid-cols-[260px_minmax(0,1fr)] bg-base text-text">
      <aside className="min-h-0 border-r border-surface0 bg-mantle">
        <div className="border-b border-surface0 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequestArrow className="h-4 w-4 text-mauve" />
            충돌 해결
          </div>
          <div className="mt-1 text-[11px] text-overlay1">{request.files.length}개 파일</div>
        </div>
        <div className="p-2">
          {request.files.map((path) => (
            <button
              key={path}
              onClick={() => setSelectedPath(path)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] ${
                selectedPath === path ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/60'
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-yellow" />
              <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
              {choicesByFile[path] && (
                <span className="shrink-0 rounded bg-surface1 px-1.5 py-0.5 text-[10px] text-overlay1">
                  선택됨
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex items-center gap-3 border-b border-surface0 bg-mantle px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-semibold">{selectedPath}</div>
            <div className="text-[11px] text-overlay1">
              변경 라인 묶음마다 원본 또는 내 작업을 선택합니다
            </div>
          </div>
          <button
            onClick={() => window.close()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-subtext1">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 파일 읽는 중
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-surface1 bg-mantle">
              <div className="grid border-b border-surface0 bg-base/35 lg:grid-cols-2">
                <div className="min-w-0 border-b border-surface0 px-3 py-2 lg:border-b-0 lg:border-r">
                  <div className="text-[12px] font-semibold text-text">원본</div>
                  <div className="truncate font-mono text-[11px] text-overlay1">{file.originLabel}</div>
                </div>
                <div className="min-w-0 px-3 py-2">
                  <div className="text-[12px] font-semibold text-text">내 작업</div>
                  <div className="truncate font-mono text-[11px] text-overlay1">{file.worktreeLabel}</div>
                </div>
              </div>
              {blocks.map((block) =>
                block.kind === 'same' ? (
                  <div
                    key={`same-${block.originStart}-${block.worktreeStart}`}
                    className="grid border-b border-surface0/40 lg:grid-cols-2"
                  >
                    <div className="min-w-0 border-b border-surface0/40 py-1 lg:border-b-0 lg:border-r">
                      {codeRows(block.lines, block.originStart)}
                    </div>
                    <div className="min-w-0 py-1">{codeRows(block.lines, block.worktreeStart)}</div>
                  </div>
                ) : (
                  <div key={block.id} className="grid border-b border-surface0 lg:grid-cols-2">
                    <div className="min-w-0 border-b border-yellow/20 bg-yellow/5 lg:border-b-0 lg:border-r">
                      <div className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[11px] text-yellow">
                          원본 {lineRange(block.originStart, block.originLines.length)}라인
                        </span>
                        <button
                          onClick={() => choose(block.id, 'origin')}
                          className={`rounded px-2 py-1 text-[11px] ${
                            choices[block.id] === 'origin'
                              ? 'bg-yellow/20 text-yellow'
                              : 'text-overlay1 hover:bg-surface0 hover:text-text'
                          }`}
                        >
                          이쪽 선택
                        </button>
                      </div>
                      {codeRows(block.originLines, block.originStart)}
                    </div>
                    <div className="min-w-0 bg-mauve/5">
                      <div className="flex items-center justify-between gap-2 px-2 py-1">
                        <span className="text-[11px] text-mauve">
                          내 작업 {lineRange(block.worktreeStart, block.worktreeLines.length)}라인
                        </span>
                        <button
                          onClick={() => choose(block.id, 'worktree')}
                          className={`rounded px-2 py-1 text-[11px] ${
                            choices[block.id] === 'worktree'
                              ? 'bg-mauve/20 text-mauve'
                              : 'text-overlay1 hover:bg-surface0 hover:text-text'
                          }`}
                        >
                          이쪽 선택
                        </button>
                      </div>
                      {codeRows(block.worktreeLines, block.worktreeStart)}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-surface0 bg-mantle px-4 py-3">
          {message && (
            <div className={`min-w-0 flex-1 truncate text-[12px] ${message.ok ? 'text-green' : 'text-red'}`}>
              {message.text}
            </div>
          )}
          {!message && (
            <div className="min-w-0 flex-1 text-[12px] text-overlay1">
              현재 파일 {selectedCount}/{changed.length}개 변경 묶음 선택됨
            </div>
          )}
          <button
            onClick={() => void apply()}
            disabled={applying || loading}
            className="flex min-h-9 items-center gap-1.5 rounded-md bg-green px-4 py-2 text-[12px] font-semibold text-crust hover:bg-teal disabled:cursor-not-allowed disabled:bg-surface1 disabled:text-overlay1"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            선택 적용
          </button>
        </footer>
      </main>
    </div>
  )
}
