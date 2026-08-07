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

const labelFor = (path: string): string => {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.(test|spec)\b/, ' 테스트').replace(/\.[^.]+$/, '')
}

/** git diff에서 제목과 파일별 변경 요약을 만든다. */
export function generateCommitMessage(diff: string): GeneratedCommitMessage {
  const workingMarker = diff.indexOf('# 커밋되지 않은 tracked 변경')
  const untrackedMarker = diff.indexOf('# 새 파일 - 아직 git 에 추가되지 않음')
  const pendingStart = [workingMarker, untrackedMarker]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const source = pendingStart === undefined ? diff : diff.slice(pendingStart)
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
      const path = line.match(/^\+\+\+ (.+)$/)?.[1]
      if (path) files.push({ path, added: true, deleted: false, additions: 0, deletions: 0 })
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

  const onlyDocs = files.every(({ path }) => /(^|\/)(docs?|README)(\/|\.|$)/i.test(path))
  const onlyTests = files.every(({ path }) => /\.(test|spec)\.[^.]+$/.test(path))
  const addedHook = files.find(({ path, added }) => added && /\/hooks?\/use-[^/]+\.[^.]+$/.test(path))
  const testsChanged = files.some(({ path }) => /\.(test|spec)\.[^.]+$/.test(path))
  const primary = addedHook ?? files.find(({ path }) => !/\.(test|spec)\.[^.]+$/.test(path)) ?? files[0]
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
