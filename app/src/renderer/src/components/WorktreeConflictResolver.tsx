import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileCode2, GitPullRequestArrow, Loader2, X } from 'lucide-react'
import type {
  WorktreeConflictFile,
  WorktreeConflictResolverRequest,
  WorktreeRebaseResult,
} from '@shared/session'

type Side = 'origin' | 'worktree'
export type DiffBlock =
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
  binary: false,
}

const MAX_DIFF_CELLS = 2_000_000
const MAX_RENDER_LINES = 5_000
const MAX_RENDER_CHARS = 1_000_000

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function isLargeText(file: WorktreeConflictFile): boolean {
  if (file.originContent.length > MAX_RENDER_CHARS || file.worktreeContent.length > MAX_RENDER_CHARS) {
    return true
  }
  return (
    Math.max(splitLines(file.originContent).length, splitLines(file.worktreeContent).length) >
    MAX_RENDER_LINES
  )
}

function requiresWholeChoice(file: WorktreeConflictFile): boolean {
  return file.binary || file.originMissing || file.worktreeMissing || isLargeText(file)
}

export function diffBlocks(originText: string, worktreeText: string): DiffBlock[] {
  const a = splitLines(originText)
  const b = splitLines(worktreeText)
  const blocks: DiffBlock[] = []
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

  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    pushSame(a[prefix], prefix + 1, prefix + 1)
    prefix += 1
  }
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd -= 1
    bEnd -= 1
  }

  const middleA = a.slice(prefix, aEnd)
  const middleB = b.slice(prefix, bEnd)
  if (middleA.length * middleB.length > MAX_DIFF_CELLS) {
    pushChange(middleA, middleB, prefix + 1, prefix + 1)
  } else {
    const dp = Array.from({ length: middleA.length + 1 }, () =>
      Array<number>(middleB.length + 1).fill(0),
    )
    for (let x = middleA.length - 1; x >= 0; x -= 1) {
      for (let y = middleB.length - 1; y >= 0; y -= 1) {
        dp[x][y] =
          middleA[x] === middleB[y]
            ? dp[x + 1][y + 1] + 1
            : Math.max(dp[x + 1][y], dp[x][y + 1])
      }
    }

    let i = 0
    let j = 0
    while (i < middleA.length || j < middleB.length) {
      if (i < middleA.length && j < middleB.length && middleA[i] === middleB[j]) {
        pushSame(middleA[i], prefix + i + 1, prefix + j + 1)
        i += 1
        j += 1
        continue
      }
      const originStart = prefix + i + 1
      const worktreeStart = prefix + j + 1
      const originLines: string[] = []
      const worktreeLines: string[] = []
      while (i < middleA.length || j < middleB.length) {
        if (i < middleA.length && j < middleB.length && middleA[i] === middleB[j]) break
        if (
          j >= middleB.length ||
          (i < middleA.length && dp[i + 1][j] >= dp[i][j + 1])
        ) {
          originLines.push(middleA[i])
          i += 1
        } else {
          worktreeLines.push(middleB[j])
          j += 1
        }
      }
      pushChange(originLines, worktreeLines, originStart, worktreeStart)
    }
  }

  for (let i = aEnd, j = bEnd; i < a.length && j < b.length; i += 1, j += 1) {
    pushSame(a[i], i + 1, j + 1)
  }

  return blocks
}

export function buildResolved(
  blocks: DiffBlock[],
  choices: Record<string, Side>,
  originText: string,
  worktreeText: string,
): string {
  const lines = blocks.flatMap((block) => {
    if (block.kind === 'same') return block.lines
    return choices[block.id] === 'origin' ? block.originLines : block.worktreeLines
  })
  const last = blocks[blocks.length - 1]
  const trailingNewline =
    last?.kind === 'change'
      ? choices[last.id] === 'origin'
        ? originText.endsWith('\n')
        : worktreeText.endsWith('\n')
      : originText.endsWith('\n') === worktreeText.endsWith('\n')
        ? originText.endsWith('\n')
        : worktreeText.endsWith('\n')
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`
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
    <div
      key={`${index}:${line}`}
      className="grid w-max min-w-full grid-cols-[48px_minmax(max-content,1fr)] font-mono text-[12px] leading-5"
    >
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
  const [request, setRequest] = useState<WorktreeConflictResolverRequest | null>()
  const [selectedPath, setSelectedPath] = useState('')
  const [filesByPath, setFilesByPath] = useState<Record<string, WorktreeConflictFile>>({})
  const [choicesByFile, setChoicesByFile] = useState<Record<string, Record<string, Side>>>({})
  const [wholeChoices, setWholeChoices] = useState<Record<string, Side>>({})
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  useEffect(() => {
    void window.api
      .conflictResolverRequest(token)
      .then((next) => {
        setRequest(next ?? null)
        setSelectedPath(next?.files[0] ?? '')
      })
      .catch(() => setRequest(null))
  }, [token])

  useEffect(() => {
    if (!request || !selectedPath) return
    if (filesByPath[selectedPath]) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void window.api
      .worktreeConflictFile(request.sessionId, selectedPath)
      .then((next) => {
        if (active && next) setFilesByPath((prev) => ({ ...prev, [selectedPath]: next }))
      })
      .catch((error) => {
        if (active) {
          setMessage({ ok: false, text: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' })
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [filesByPath, request, selectedPath])

  const file = filesByPath[selectedPath] ?? EMPTY
  const largeText = isLargeText(file)
  const wholeFileChoice = requiresWholeChoice(file)

  const blocks = useMemo(
    () => (requiresWholeChoice(file) ? [] : diffBlocks(file.originContent, file.worktreeContent)),
    [file],
  )
  const choices = choicesByFile[file.path] ?? {}
  const changed = useMemo(
    () => blocks.filter((block): block is Extract<DiffBlock, { kind: 'change' }> => block.kind === 'change'),
    [blocks],
  )
  const selectedCount = changed.filter((block) => choices[block.id]).length

  const completedByPath = useMemo(() => {
    if (!request) return {}
    return Object.fromEntries(
      request.files.map((path) => {
        const target = filesByPath[path]
        if (!target) return [path, false]
        if (requiresWholeChoice(target)) {
          return [path, Boolean(wholeChoices[path])]
        }
        const targetChoices = choicesByFile[path] ?? {}
        const targetChanges = diffBlocks(target.originContent, target.worktreeContent).filter(
          (block) => block.kind === 'change',
        )
        return [path, targetChanges.every((block) => Boolean(targetChoices[block.id]))]
      }),
    ) as Record<string, boolean>
  }, [choicesByFile, filesByPath, request, wholeChoices])
  const completedFiles = request?.files.filter((path) => completedByPath[path]).length ?? 0
  const allCompleted = Boolean(request && completedFiles === request.files.length)

  function choose(blockId: string, side: Side): void {
    setChoicesByFile((prev) => ({
      ...prev,
      [file.path]: { ...(prev[file.path] ?? {}), [blockId]: side },
    }))
  }

  function chooseWhole(side: Side): void {
    if (!file.path) return
    setWholeChoices((prev) => ({ ...prev, [file.path]: side }))
  }

  async function apply(): Promise<void> {
    if (!request || !allCompleted) return
    setApplying(true)
    setMessage(undefined)
    try {
      const resolved = request.files.map((path) => {
          const target = filesByPath[path]
          if (!target) throw new Error(`${path}: 충돌 정보를 먼저 확인해 주세요.`)
          if (requiresWholeChoice(target)) {
            const side = wholeChoices[path]
            if (!side) throw new Error(`${path}: 사용할 쪽을 선택해 주세요.`)
            const missing = side === 'origin' ? target.originMissing : target.worktreeMissing
            return missing ? { path, deleted: true } : { path, side }
          }
          const targetBlocks = diffBlocks(target.originContent, target.worktreeContent)
          return {
            path,
            content: buildResolved(
              targetBlocks,
              choicesByFile[path] ?? {},
              target.originContent,
              target.worktreeContent,
            ),
          }
        })
      const result: WorktreeRebaseResult = await window.api.resolveWorktreeConflicts(request.sessionId, resolved)
      setMessage({ ok: result.ok, text: result.message })
      if (result.ok) {
        window.setTimeout(() => window.close(), 900)
      } else if (result.conflictFiles?.length) {
        setRequest({ ...request, files: result.conflictFiles })
        setSelectedPath(result.conflictFiles[0])
        setFilesByPath({})
        setChoicesByFile({})
        setWholeChoices({})
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : '충돌 해결 적용 실패' })
    } finally {
      setApplying(false)
    }
  }

  if (request === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-base text-subtext1">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 충돌 정보 불러오는 중
      </div>
    )
  }

  if (request === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-base text-subtext1">
        충돌 정보를 찾지 못했습니다
      </div>
    )
  }

  return (
    <div className="grid h-screen grid-cols-[260px_minmax(0,1fr)] bg-base text-text">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-surface0 bg-mantle">
        <div className="border-b border-surface0 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequestArrow className="h-4 w-4 text-mauve" />
            충돌 해결
          </div>
          <div className="mt-1 text-[11px] text-overlay1">{request.files.length}개 파일</div>
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
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
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                  completedByPath[path]
                    ? 'bg-green/15 text-green'
                    : 'bg-surface1 text-overlay1'
                }`}
              >
                {completedByPath[path] ? '완료' : '미확인'}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex items-center gap-3 border-b border-surface0 bg-mantle px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-semibold">{selectedPath}</div>
            <div className="text-[11px] text-overlay1">
              {wholeFileChoice
                ? '파일 전체에서 사용할 쪽을 선택합니다'
                : '변경 라인 묶음마다 원본 또는 내 작업을 선택합니다'}
            </div>
          </div>
          <button
            onClick={() => window.close()}
            title="닫기"
            aria-label="충돌 해결 창 닫기"
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
              {wholeFileChoice ? (
                <div className="grid lg:grid-cols-2">
                  {(['origin', 'worktree'] as const).map((side) => {
                    const missing = side === 'origin' ? file.originMissing : file.worktreeMissing
                    const content = side === 'origin' ? file.originContent : file.worktreeContent
                    const selected = wholeChoices[file.path] === side
                    return (
                      <div
                        key={side}
                        className={`min-w-0 overflow-x-auto border-surface0 py-2 ${
                          side === 'origin' ? 'border-b lg:border-b-0 lg:border-r' : ''
                        } ${selected ? (side === 'origin' ? 'bg-yellow/10' : 'bg-mauve/10') : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2 px-3 pb-2">
                          <span className={side === 'origin' ? 'text-yellow' : 'text-mauve'}>
                            {missing
                              ? '파일 삭제'
                              : file.binary
                                ? '바이너리 파일'
                                : largeText
                                  ? '큰 텍스트 파일'
                                  : '파일 전체'}
                          </span>
                          <button
                            onClick={() => chooseWhole(side)}
                            className={`rounded px-2 py-1 text-[11px] ${
                              selected
                                ? side === 'origin'
                                  ? 'bg-yellow/20 text-yellow'
                                  : 'bg-mauve/20 text-mauve'
                                : 'text-overlay1 hover:bg-surface0 hover:text-text'
                            }`}
                          >
                            {selected ? '선택 완료' : '이쪽 선택'}
                          </button>
                        </div>
                        {missing ? (
                          <div className="px-3 py-6 text-center text-[12px] text-overlay1">
                            이쪽을 선택하면 파일을 삭제합니다
                          </div>
                        ) : file.binary ? (
                          <div className="px-3 py-6 text-center text-[12px] text-overlay1">
                            바이너리 내용은 코드 비교를 지원하지 않습니다
                          </div>
                        ) : largeText ? (
                          <div className="px-3 py-6 text-center text-[12px] text-overlay1">
                            파일이 커서 전체 선택 모드로 표시합니다
                          </div>
                        ) : (
                          codeRows(splitLines(content), 1)
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : blocks.map((block) =>
                block.kind === 'same' ? (
                  <div
                    key={`same-${block.originStart}-${block.worktreeStart}`}
                    className="grid border-b border-surface0/40 lg:grid-cols-2"
                  >
                    <div className="min-w-0 overflow-x-auto border-b border-surface0/40 py-1 lg:border-b-0 lg:border-r">
                      {codeRows(block.lines, block.originStart)}
                    </div>
                    <div className="min-w-0 overflow-x-auto py-1">
                      {codeRows(block.lines, block.worktreeStart)}
                    </div>
                  </div>
                ) : (
                  <div key={block.id} className="grid border-b border-surface0 lg:grid-cols-2">
                    <div className="min-w-0 overflow-x-auto border-b border-yellow/20 bg-yellow/5 lg:border-b-0 lg:border-r">
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
                    <div className="min-w-0 overflow-x-auto bg-mauve/5">
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
              전체 파일 {completedFiles}/{request.files.length}개 확인 완료
              {!wholeFileChoice && ` · 현재 파일 ${selectedCount}/${changed.length}개 선택`}
            </div>
          )}
          <button
            onClick={() => void apply()}
            disabled={applying || loading || !allCompleted}
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
