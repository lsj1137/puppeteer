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
