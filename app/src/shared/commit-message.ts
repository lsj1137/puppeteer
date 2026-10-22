export interface GeneratedCommitMessage {
  subject: string
  body: string[]
  value: string
}

interface DiffFile {
  path: string
  added: boolean
  deleted: boolean
  additions: number
  deletions: number
}

const TEST_FILE = /\.(test|spec)\.[^.]+$/
const DOC_FILE = /(^|\/)(docs?|README)(\/|\.|$)/i
/** 저장소 설정 파일 — 점 파일(.gitignore 등)과 lock 파일 */
const CONFIG_FILE = /(^|\/)(\.[^/]+|package-lock\.json)$/

const labelFor = (path: string): string => {
  const segments = path.split('/')
  const name = segments.pop() ?? path
  // .gitignore 처럼 점으로 시작하는 파일은 이름 전체가 확장자로 잘리지 않게 그대로 쓴다.
  if (/^\.[^.]+$/.test(name)) return name
  const label = name.replace(/\.(test|spec)\b/, ' 테스트').replace(/\.[^.]+$/, '')
  // index 는 어느 모듈인지 알 수 없어 상위 폴더를 붙인다.
  const parent = segments.pop()
  return /^index( 테스트)?$/.test(label) && parent ? `${parent}/${label}` : label
}

const changeSize = (file: DiffFile): number => file.additions + file.deletions

/**
 * 앱이 diff 사이에 끼워 넣는 구획 표지(`worktreeDiff`). **줄 전체가 같을 때만** 표지로 본다.
 * diff 본문 줄은 늘 `+`·`-`·공백으로 시작하므로 `#` 로 시작하는 줄은 앱이 넣은 것뿐이다.
 * 예전엔 글자만 찾았는데, 이 파일 자신이 표지 문자열을 담고 있어서 이 파일의 변경이 비교 범위에
 * 들어가면 소스 안의 글자를 표지로 잡아 이미 커밋된 다른 파일까지 메시지에 섞였다.
 */
const PENDING_MARKER = /^# (커밋되지 않은 tracked 변경|새 파일 - 아직 git 에 추가되지 않음)$/m

/** git diff에서 제목과 파일별 변경 요약을 만든다. */
export function generateCommitMessage(diff: string): GeneratedCommitMessage {
  // 표지 앞(`기준..HEAD`)은 이전 턴에 이미 커밋된 변경이다. 이번 커밋에 들어갈 것만 요약한다.
  const pendingStart = diff.search(PENDING_MARKER)
  const source = pendingStart < 0 ? diff : diff.slice(pendingStart)
  const files: DiffFile[] = []
  let current: DiffFile | undefined
  let untracked = false

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('# 새 파일')) {
      untracked = true
      current = undefined
      continue
    }
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (header) {
      untracked = false
      current = { path: header[2], added: false, deleted: false, additions: 0, deletions: 0 }
      files.push(current)
      continue
    }
    if (untracked) {
      // `+++ 경로` 뒤에 탭으로 줄 수(`\t+12`)가 붙어 온다. 없으면(읽지 못한 파일) 0 이다.
      const match = line.match(/^\+\+\+ (.+?)(?:\t\+(\d+))?$/)
      if (match) {
        files.push({ path: match[1], added: true, deleted: false, additions: Number(match[2] ?? 0), deletions: 0 })
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('new file mode ')) current.added = true
    else if (line.startsWith('deleted file mode ')) current.deleted = true
    else if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1
  }

  if (files.length === 0) {
    return { subject: 'chore: 작업 변경 반영', body: [], value: 'chore: 작업 변경 반영' }
  }

  const onlyDocs = files.every(({ path }) => DOC_FILE.test(path))
  const onlyTests = files.every(({ path }) => TEST_FILE.test(path))
  const onlyMeta = files.every(({ path }) => DOC_FILE.test(path) || CONFIG_FILE.test(path))
  const addedHook = files.find(({ path, added }) => added && /\/hooks?\/use-[^/]+\.[^.]+$/.test(path))
  const testsChanged = files.some(({ path }) => TEST_FILE.test(path))
  // 소스 파일 중에서 대표를 고른다. 새 파일이 있으면 기능 추가로 보고 우선한다 —
  // untracked 새 파일은 diff 끝에 줄 수 없이 붙으므로 순서·크기로는 뽑히지 않는다.
  // 없으면 가장 많이 바뀐 파일을 쓴다.
  const sources = files.filter(({ path }) => !TEST_FILE.test(path) && !DOC_FILE.test(path) && !CONFIG_FILE.test(path))
  const largest = (list: DiffFile[]): DiffFile | undefined =>
    list.reduce<DiffFile | undefined>((best, file) => (!best || changeSize(file) > changeSize(best) ? file : best), undefined)
  const primary =
    addedHook ??
    largest(sources.filter(({ added }) => added)) ??
    largest(sources) ??
    files.find(({ path }) => !TEST_FILE.test(path)) ??
    files[0]
  const metaPrimary = files.find(({ path }) => CONFIG_FILE.test(path)) ?? primary
  const packageVersion = source.match(/^\+\s*"version":\s*"([^\"]+)"/m)?.[1]
  const versionChanged = Boolean(
    packageVersion &&
    files.some(({ path }) => /(^|\/)package\.json$/.test(path)) &&
    source.match(/^-\s*"version":\s*"([^\"]+)"/m),
  )

  let subject: string
  if (versionChanged) subject = `chore: 버전 ${packageVersion}로 갱신`
  else if (onlyDocs) subject = `docs: ${files.length === 1 ? labelFor(primary.path) : `문서 ${files.length}개`} 갱신`
  else if (onlyTests) subject = `test: ${files.length === 1 ? labelFor(primary.path) : '회귀 테스트'} 보강`
  else if (onlyMeta) subject = `chore: ${labelFor(metaPrimary.path)}${files.length > 1 ? ` 외 ${files.length - 1}개` : ''} 갱신`
  else if (addedHook) subject = `refactor: ${labelFor(addedHook.path)} 훅 분리`
  else if (primary.added) subject = `feat: ${labelFor(primary.path)} 추가`
  else subject = `refactor: ${labelFor(primary.path)} 개선`

  const body = files.map((file) => {
    const action = file.added ? '추가' : file.deleted ? '삭제' : '수정'
    return `- ${file.path} ${action} (+${file.additions}/-${file.deletions})`
  })
  if (testsChanged && !onlyTests) body.push('- 관련 회귀 테스트 보강')

  return { subject, body, value: [subject, '', ...body].join('\n') }
}
