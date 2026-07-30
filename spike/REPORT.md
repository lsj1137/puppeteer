# 스파이크 결과

Claude Code CLI 2.1.220 실측. 원시 로그는 `out/*.jsonl`.

---

## 환경

| | WSL | Windows |
|---|---|---|
| claude | 2.1.220 (bun 설치, `~/.bun/bin/claude`) | 2.1.220 (npm 설치, 스파이크용으로 추가) |
| node | v18.19.1 | v24.14.0 |

사용자는 Windows에서 bun 설치본이 크래시해 WSL로 이전한 이력이 있음. **설치 방식(bun/npm/native)에 따라 안정성이 갈리므로 앱은 실행기를 탐지하고 선택할 수 있어야 한다.**

---

## S1 — stream-json 이벤트 스키마

명령: `claude -p "..." --output-format stream-json --verbose < /dev/null`

### 관측된 이벤트 타입

| 이벤트 | 시점 | 핵심 필드 |
|---|---|---|
| `system` / `init` | 최초 1회 | `session_id`, `cwd`, `model`, `permissionMode`, `tools[]`, `memory_paths`, `claude_code_version`, `apiKeySource`, `slash_commands[]`, `agents[]`, `skills[]`, `plugins[]` |
| `rate_limit_event` | 수시 | `rate_limit_info.status` / `resetsAt` / `rateLimitType` / `overageStatus` |
| `assistant` | 콘텐츠 블록마다 | `message.id`, `message.content[]` (text 또는 tool_use), `message.usage` |
| `user` | 도구 실행 후 | `message.content[].tool_result`, **`tool_use_result.stdout/stderr`** (구조화) |
| `system` / `thinking_tokens` | 사고 중 | |
| `result` / `success` | 최종 1회 | `total_cost_usd`, `usage`, `modelUsage`(모델별 분해), `permission_denials[]`, `terminal_reason`, `num_turns`, `ttft_ms`, `duration_ms`, `result`(최종 텍스트) |

### 설계에 직접 반영되는 것

| 발견 | 반영 |
|---|---|
| **`session_id`가 첫 이벤트에 즉시 나옴** | Resume 매핑을 세션 시작 직후 저장 가능 |
| **`total_cost_usd`가 result에 직접 제공** | 비용을 자체 계산할 필요 없음. `modelUsage`로 모델별 분해까지 제공 |
| **`permission_denials[]`가 구조화 제공** | 승인 거부 이력을 그대로 Inbox에 반영 (`tool_name`, `tool_use_id`, `tool_input`) |
| **`memory_paths`를 init이 알려줌** | Memory 파일 경로를 앱이 추측할 필요 없음 |
| **`tool_use_result.stdout/stderr` 분리 제공** | 로그 Artifact를 파싱 없이 생성 |
| **`rate_limit_event` 존재** | 기획서에 없던 정보. 세션 상태 바에 표시할 가치 있음 |
| `apiKeySource`, `permissionMode` | 인증·권한 상태 탐지에 사용 |
| **assistant 이벤트가 델타가 아닌 블록 단위** | 코드펜스 파싱이 단순해짐. 단 `message.id`로 묶어야 함. 토큰 단위가 필요하면 `--include-partial-messages` |

### 비용 관측

사소한 프롬프트 1회에 **약 $0.12–0.13**. 원인은 사용자 환경의 글로벌 메모리·스킬 설명이 매 세션 캐시 생성(약 9K–12K 토큰)되기 때문. 세션을 남발하면 비용이 빠르게 누적되므로 **앱의 비용 표시는 선택이 아니라 필수**.

---

## S2 — 승인 인터셉트 (핵심)

### 실측 조건

`--settings` 로 `PreToolUse` hook 주입, hook이 20초 지연 후 `deny` 반환, `timeout: 300` 설정.

### 결과

| 항목 | 결과 |
|---|---|
| hook 20초 지연 | **완주** (중도 종료 없음) |
| `timeout: 300` 설정 | **적용됨** |
| 세션 상태 | `is_error: false`, `terminal_reason: completed`, `num_turns: 2` — **세션이 죽지 않음** |
| deny 사유 문구 전달 | **모델에게 그대로 전달되고 인용됨** |
| `permission_denials` | 거부 이력이 구조화되어 result에 기록 |

모델 응답 발췌:

> The command didn't produce output. Instead the tool call came back with an error:
> `[스파이크] 20초 지연 후 응답. 이 작업은 보류되었습니다. 세션을 종료하지 말고 대기하세요.`

**"보류 후 재개" 전략이 실증됐다.** 거부 사유에 담은 지시를 모델이 읽고, 세션을 끝내지 않고 상황을 사용자에게 보고했다.

### 전제 변경

기존 설계는 "Windows 네이티브 = Agent SDK(타임아웃 없음)"를 주 경로로 삼고, hook 경로를 타임아웃 때문에 열등한 대안으로 취급했다. 실측 결과:

- hook `timeout`을 크게 잡을 수 있으므로 만료 자체가 드물다
- 만료되더라도 세션이 죽지 않고 보류·재개가 성립한다

→ **hook 경로도 1급 경로다. WSL 단독 환경이 열등한 선택이 아니다.** Agent SDK는 필수가 아니라 Windows에서의 선택지 중 하나로 격하한다.

### 부수 발견 — `PermissionRequest` hook 이벤트

`PreToolUse` 외에 **`PermissionRequest`** hook 이벤트가 존재한다. 승인 인터셉트 전용 지점으로 보이므로 어느 쪽이 적합한지 추가 확인 필요.

전체 hook 이벤트: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `Stop`, `StopFailure`, `Notification`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `PermissionRequest`

---

## S2 부산물 — 설정 주입 방식 확정

사용자 `~/.claude/settings.json`에 **이미 다른 도구(orca)가 hook을 11종 등록해 두고 있었다.**

→ **앱은 사용자 settings 파일을 절대 편집하지 않는다.** `--settings '<JSON 문자열>'` 인자로 세션 단위 주입만 한다. 이번 스파이크에서 이 방식이 정상 동작함을 확인했다.

```
--settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[
  {"type":"command","command":"<앱 hook 경로>","timeout":300}]}]}}'
```

기존 hook과 공존하며, 앱 종료 후 잔여물이 남지 않는다.

---

## 기타 실측

| 항목 | 내용 |
|---|---|
| stdin | 리다이렉트하지 않으면 3초 대기 후 경고. 어댑터는 **`< /dev/null` 또는 명시적 파이프 필수** |
| `--permission-mode` 선택지 | `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` |
| `manual` 모드 | 단독으로는 승인 요청 이벤트가 관측되지 않았다. 의미 미확정 — 추가 확인 필요 |
| 한글 경로 | Node `URL.pathname`이 퍼센트 인코딩함 → **`fileURLToPath` 필수**. 사용자 프로젝트 경로에 한글이 흔하므로 앱 전반에 적용 |
| 대화 내 코드펜스 | 실제로 등장 확인 (` ```hello-from-spike``` `) → 사후 파싱 필요성 실증 |
| 유용한 플래그 | `--settings`, `--include-partial-messages`, `--fork-session`, `--allowedTools`, `--disallowedTools`, `--append-system-prompt`, `--json-schema`, `--input-format stream-json` |

---

## 미검증 / 다음 단계

| # | 항목 | 비고 |
|---|---|---|
| 1 | hook `timeout` 상한값 | 300은 확인. 그 이상은 미확인 |
| 2 | `PermissionRequest` vs `PreToolUse` 중 적합한 인터셉트 지점 | |
| 3 | `--permission-mode manual` 의 정확한 의미 | |
| 4 | Agent SDK (`canUseTool`, WSL 실행기 지원) | S3 |
| 5 | Windows node → `wsl.exe` spawn 시 인코딩·경로 | S4 |
| 6 | `--include-partial-messages` 델타 형식 | 실시간 타이핑 UX 필요 시 |
| 7 | Codex CLI 전반 | v2 |
