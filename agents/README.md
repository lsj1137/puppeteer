# Puppeteer Agents

Puppeteer의 Agent 가져오기에서 GitHub의 Markdown 파일 주소를 붙여 넣으면 전문과 요청 권한을
검토한 뒤 전역 라이브러리에 저장하거나 원본과 Linked 상태로 유지할 수 있다.

## release-maintainer

릴리스 전에 변경 범위, 검증 명령, 버전·태그와 GitHub Actions 트리거를 점검하는 Agent다.
커밋·태그·푸시·Release 같은 외부 변경은 사용자가 명시적으로 요청한 경우에만 수행한다.

GitHub에 이 저장소를 푸시한 뒤 다음 파일 주소를 앱의 Agent 가져오기에 사용한다.

```text
https://github.com/lsj1137/puppeteer/blob/main/agents/release-maintainer.md
```

앱은 GitHub의 `blob` 주소를 raw 주소로 변환한다. 가져오기 화면에서 본문과 요청 권한을 확인하고,
프로젝트 적용 대상과 실제 허용 도구를 로컬에서 다시 선택한다. Linked로 저장하면 이후 원본 변경을
확인할 수 있으며, 업데이트할 때도 로컬 권한은 유지된다.

### 요청 권한

- Read · Glob · Grep: 저장소와 릴리스 설정 조사
- Bash: Git 상태 및 기존 검증 명령 실행
- Edit: 사용자가 승인한 버전 파일과 릴리스 문서 수정

공개 Agent 파일은 실행 지침이므로 변경 리뷰 없이 권한을 확대하지 않는다.

## agent-creator

반복 작업 아이디어를 Agent · Skill · Memory 중 알맞은 형태로 먼저 구분하고, Agent가 적합하면
역할·범위·최소 권한·완료 조건을 갖춘 전체 Markdown 초안을 만드는 생성 도우미다. 초안을 먼저
보여주며 사용자가 명시적으로 승인하기 전에는 파일을 작성하거나 기존 Agent를 덮어쓰지 않는다.

```text
https://github.com/lsj1137/puppeteer/blob/main/agents/agent-creator.md
```

프로젝트 구조를 읽기 위한 Read · Glob · Grep과 승인된 Agent 파일을 저장하기 위한 Edit만 요청한다.
커밋·push나 Agent 이외의 코드 변경은 별도 요청 없이는 수행하지 않는다.

## git-worktree-doctor

linked worktree의 경로 오류, dirty 상태, ahead/behind 불일치, `index.lock`, 자동 커밋·병합 실패를
읽기 전용으로 진단하고 데이터 손실 없는 복구 절차를 제시하는 Agent다.

```text
https://github.com/lsj1137/puppeteer/blob/main/agents/git-worktree-doctor.md
```

### 요청 권한

- Read · Glob · Grep: 저장소 문서와 Git 설정 조사
- Bash: `git status`, `worktree list` 같은 읽기 전용 Git 확인

`reset --hard`, `clean -fd`, 강제 checkout, force push와 브랜치·태그·stash·worktree 삭제는 하지
않는다. 확인하지 못한 원인은 추측 대신 `확인하지 못함`으로 남긴다.
