/** 보고서 요청의 출발점. 사용자가 지우고 다시 써도 되는 초안이다. */
export const DEFAULT_REPORT_PROMPT = [
  '아래 작업 기록으로 업무보고를 작성해줘.',
  '',
  '- 프로젝트별로 묶고, 각 항목은 «무엇을 했는지» 한 문장으로.',
  '- 기술 용어보다 업무 표현을 쓴다.',
  '- 맨 앞에 기간 전체를 두세 줄로 요약한다.',
].join('\n')

/**
 * 저장할 때 제안할 파일 이름.
 *
 * 날짜를 앞에 두면 파일 목록이 시간순으로 정렬된다. 경로 구분자와 금지 문자는
 * 미리 걸러낸다 — 프로젝트 별칭에 `/` 나 `:` 가 들어갈 수 있다.
 */
export function reportFileName(startedAt: number, projectLabel?: string): string {
  const d = new Date(startedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const label = projectLabel?.replace(/[\\/:*?"<>|]/g, '').trim()
  return label ? `${date}_${label}_업무보고.md` : `${date}_업무보고.md`
}
