/** 순번을 셀 때 필요한 만큼만. 화면 타입 전체를 끌고 오지 않는다. */
export interface ReviewableProposal {
  id: number
  entryId: string
}

/**
 * 고른 제안이 같은 Memory 의 제안들 중 몇 번째인지.
 *
 * 오른쪽 검토 칸은 한 번에 한 건만 보여주고 `‹ ›` 로 옮긴다. 왼쪽 목록에서 세 번째 제안을
 * 눌렀다면 오른쪽도 세 번째로 가야 한다 — 항목만 열고 순번을 0 으로 두면 같은 프로젝트의
 * 다른 제안을 누를 때 아무 일도 일어나지 않는 것처럼 보인다.
 *
 * 순서는 오른쪽 목록을 만들 때 쓰는 필터와 같아야 하므로 같은 배열에서 같은 방식으로 센다.
 */
export function proposalReviewIndex(
  proposals: ReviewableProposal[],
  picked: ReviewableProposal,
): number {
  const index = proposals
    .filter((proposal) => proposal.entryId === picked.entryId)
    .findIndex((proposal) => proposal.id === picked.id)
  return index < 0 ? 0 : index
}
