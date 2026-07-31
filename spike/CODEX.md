# Codex CLI 스파이크

`codex-cli 0.146.0` · WSL(Ubuntu) · bun 설치

## S1. 설치 — WSL 에 리눅스 npm 이 없다

WSL 에서 `codex` 가 Windows 설치본으로 흘러가 이렇게 깨진다.

```
Error: Missing optional dependency @openai/codex-linux-x64
  at /mnt/c/Users/.../AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js
```

플랫폼별 optional dependency 구조라, Windows 설치본에는 `codex-win32-x64` 만 있고
리눅스에서 실행되니 `codex-linux-x64` 를 찾다 실패한다. Claude 에서 겪은 interop PATH 함정과 같다.

**더 깊은 원인**: 이 WSL 에는 리눅스 npm 이 없다.

```
node → /usr/bin/node                    v18.19.1  (정상)
npm  → /mnt/c/Program Files/nodejs/npm            (Windows!)
npm config get prefix → C:\Users\...\AppData\Roaming\npm
```

에러 메시지가 시키는 `npm install -g` 를 그대로 하면 **Windows 쪽에 다시 깔려** 안 풀린다.
Claude 와 같이 bun 으로 깔아야 한다.

```bash
bun install -g @openai/codex     # codex, codex-linux-x64 함께 설치
→ /home/administrator/.bun/bin/codex
```

## S2. 비대화식 실행

`codex exec` (별칭 `e`). 주요 인자:

| 인자 | 뜻 |
|---|---|
| `--json` | 이벤트를 **JSONL** 로 stdout 에 |
| `-C, --cd <DIR>` | 작업 디렉토리 |
| `-m, --model` | 모델 |
| `-s, --sandbox <read-only\|workspace-write\|danger-full-access>` | 샌드박스 정책 |
| `-i, --image <FILE>...` | 이미지 첨부 (**파일 경로 직접 지원**) |
| `-o, --output-last-message <FILE>` | 마지막 응답만 파일로 |
| `--output-schema <FILE>` | 최종 응답 JSON Schema 강제 |
| `--skip-git-repo-check` | git 저장소 밖 실행 허용 |
| `exec resume [--last]` | 세션 이어가기 |

프롬프트는 인자 또는 stdin. **stdin 을 열어두면 `Reading additional input from stdin...` 로 멈춘다**
— Claude 와 같은 함정이라 어댑터는 `stdio: ['ignore', ...]` 를 그대로 쓰면 된다.

## S3. `--json` 이벤트 봉투 (실측)

```json
{"type":"thread.started","thread_id":"019fb5f5-dc9f-7631-b7ab-9fac318c340c"}
{"type":"turn.started"}
{"type":"error","message":"Reconnecting... 2/5 (…)"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"…"}}
```

`thread.*` / `turn.*` / `item.*` 3계열. Claude 의 `stream-json` 과 이름만 다르고 구조는 대응된다.

| Claude | Codex |
|---|---|
| `system.init` (session_id) | `thread.started` (thread_id) |
| `assistant` 메시지 | `item.completed` (item.type 별) |
| `result` | (턴 종료 이벤트 — 인증 후 확인 필요) |

**★ 실패해도 종료코드가 0 이다.** 전부 실패한 위 실행도 `exit=0` 이었다.
Claude 어댑터에서 exit code 로 판단하다 데었던 것과 같은 함정 — **이벤트로 판정해야 한다.**

## S4. 승인 인터셉트 — 훅이 있다

바이너리 문자열에서 확인한 훅 이벤트(TUI 신뢰 화면 문구 그대로):

```
Before a tool executes          → PreToolUse
When permission is requested
After a tool executes           → PostToolUse
Before/After context compaction
When a new session starts       → SessionStart
Right before a session ends
When the user submits a prompt  → UserPromptSubmit
When a subagent is created / Right before a subagent ends its turn
```

**결정 어휘가 Claude 와 동일하다**: `permissionDecision`(`allow`/`deny`/`ask`),
`hookSpecificOutput`, `hook_event_name`, `continue`, `stopReason`, `systemMessage`.
→ 우리 파일 프로토콜 승인 브로커를 거의 그대로 재사용할 수 있다.

**단, 훅에 신뢰(trust) 게이트가 있다.**

```
New hook - review required
Modified since last trusted - review required
1 hook needs review before it can run.
Managed hooks are always on
```

자동화용 우회 플래그: `--dangerously-bypass-hook-trust`.
설정 계층은 `Admin / User / Project(.codex/config.toml) / Session flags / Cloud-managed`.
훅 선언 파일 경로와 정확한 스키마는 **미확인** — 공식 매뉴얼이 프록시에 막혀 못 읽었다(S6).

## S5. 메모리 — `AGENTS.md`

Codex 는 `AGENTS.md` 를 쓴다. 우리가 프로젝트 메모리를 `AGENTS.md` 정본 +
`CLAUDE.md` = `@AGENTS.md` 다리로 잡은 선택과 맞물린다(기술스택 §7-4).

## S6. ★ 진짜 장벽 — TLS 검사 프록시

```
$ openssl s_client -connect api.openai.com:443
 0 s:CN = api.openai.com
 1 s:C = **, O = <조직>, CN = <내부 CA>      ← 검사 프록시가 재서명

$ openssl s_client -connect api.anthropic.com:443
 1 s:C = US, O = Google Trust Services   ← 가로채지 않음
```

**어떤 도메인은 통과시키고 어떤 도메인은 가로챈다.** 그래서 한쪽 CLI 만 되는 상황이 생긴다.
Codex 는 Rust(rustls) 라 시스템 신뢰 저장소만 보는데 그 CA 가 거기 없다(기본 번들 121개에 없음).

```
ERROR failed to connect to websocket: invalid peer certificate: UnknownIssuer
```

**우회 확인됨** — 검사 프록시의 루트 CA 를 번들에 합쳐 `SSL_CERT_FILE` 로 주면 TLS 를 통과한다.

```bash
openssl s_client -connect api.openai.com:443 -showcerts \
  | awk '/BEGIN CERT/,/END CERT/' > proxy-ca.pem
cat /etc/ssl/certs/ca-certificates.crt proxy-ca.pem > bundle.pem
SSL_CERT_FILE=bundle.pem codex exec --json …
→ UnknownIssuer 사라지고 401 Unauthorized (= 로그인만 남음)
```

영구 적용은 `/usr/local/share/ca-certificates/` 에 넣고 `update-ca-certificates`(sudo).

## S7. 데이터 경계

이 망에서 Anthropic 은 검사 예외, OpenAI 는 검사 대상이라 경로 자체가 다르다(S6).
그와 별개로 **인사 도메인 지식은 OpenAI 로 보내지 않는다**는 운영 방침을 정했다.

에이전트 지침은 `--agents` 로 전문이 실려 나가므로, `x-workspace.providers` 가드를
두고 인사 에이전트 3종을 `claude-cli` 로 고정했다(기술스택 §7-1-1).
Codex 는 리팩터링·UI·빌드 같은 범용 작업에만 쓴다.

## S8. 확정 사양 (공식 매뉴얼)

CA 등록 후 `developers.openai.com/codex/codex-manual.md` 를 읽어 확정했다(32,901줄).

### `--json` 이벤트

```jsonl
{"type":"thread.started","thread_id":"0199a213-…"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"…"}}
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}
```

- 이벤트: `thread.started` · `turn.started` · `turn.completed` · `turn.failed` · `item.*` · `error`
- item 종류: agent message, reasoning, command execution, file change, MCP tool call, web search, plan update
- **`turn.completed.usage` 에 토큰이 온다. 단 비용(USD)은 없다** — Claude 의 `total_cost_usd` 와 다르다.
  비용을 보이려면 앱이 모델 단가로 환산해야 한다.

### 어댑터 이벤트 대응

| 앱 이벤트 | Claude | Codex |
|---|---|---|
| session-meta | `system.init.session_id` | `thread.started.thread_id` |
| message | `assistant` | `item.completed` (type=agent_message) |
| tool-use | `assistant.tool_use` | `item.started` (type=command_execution 등) |
| tool-result | `user.tool_result` | `item.completed` (같은 id) |
| usage | `result.total_cost_usd` | `turn.completed.usage` (토큰만) |
| status 종료 | `result` | `turn.completed` / `turn.failed` |

### 훅 — 우리 승인 브로커를 그대로 쓸 수 있다

탐색 위치(모두 로드되고 서로 대체하지 않음):

```
~/.codex/hooks.json
~/.codex/config.toml   ([hooks] 인라인)
<프로젝트>/.codex/hooks.json
<프로젝트>/.codex/config.toml
```

`hooks.json` 구조는 Claude 의 `settings.hooks` 와 사실상 동일하다.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "…", "timeout": 30,
                    "statusMessage": "Checking Bash command" }] }
    ]
  }
}
```

훅 입력(stdin JSON) 공통 필드: `session_id` · `transcript_path` · `cwd` ·
`hook_event_name` · `model` (+ `permission_mode`).
`PreToolUse` 추가: `turn_id` · `tool_name` · `tool_use_id` · `tool_input`.

거부 응답 — **Claude 와 같은 모양이다.**

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "…" } }
```

`decision:"block"` 구형과 **exit code 2 + stderr** 도 받는다.
`permissionDecision:"allow"` + `updatedInput` 으로 **명령 재작성**까지 가능(Claude 에 없는 기능).

**★ 걸림돌 — 훅 신뢰(trust)**: 비관리 훅은 `/hooks` 에서 사람이 한 번 신뢰해야 실행된다.
해시 기준이라 **훅 명령이 바뀌면 다시 신뢰**해야 한다. 우리 훅 명령에는 세션별 승인 디렉터리가
들어가므로 매 세션 해시가 달라진다 → **`--dangerously-bypass-hook-trust` 가 사실상 필수**다.
(Claude 는 `--settings` 로 세션 단위 주입이라 이 문제가 없었다.)

또 `PreToolUse` 외에 **`PermissionRequest`** 이벤트가 따로 있다. 어느 쪽을 걸지 실행해 보고 정한다.

### 이어가기

```bash
codex exec resume <SESSION_ID> "후속 지시"
codex exec resume --last "…"        # 현재 디렉터리 최근 세션
```

`--all` 로 다른 디렉터리 세션까지 대상. `thread_id` 를 그대로 넘기면 된다.

## S9. 실제 턴 실측 (로그인 후)

"a.txt 읽고 b.txt 에 world 써줘" 로 한 턴. **승인 3건이 우리 `approve.sh` 로 잡혔고
파일도 정상 생성**됐다. 승인 브로커·훅 스크립트는 한 줄도 안 고치고 그대로 쓴다.

### 훅 주입 — `-c` 인라인 TOML

**`hooks_file` 같은 키는 없다.** 처음에 그렇게 짰다가 매뉴얼로 잡았다.
그대로 뒀으면 에러 없이 훅이 안 걸려 승인 인터셉트가 통째로 무력화됐을 것이다.

```
-c 'hooks.PreToolUse=[{matcher="^(Bash|apply_patch|Edit|Write)$", hooks=[{type="command", command="…", timeout=300}]}]'
--dangerously-bypass-hook-trust
```

`-c` 값은 TOML 로 파싱된다. **세션 단위 주입이라 사용자 설정도 프로젝트 폴더도 안 건드린다**
(Claude 의 `--settings` 와 같은 성격). `hooks.json` 을 쓰면 프로젝트에 파일이 남는다.

### 훅 입력 — Claude 와 필드명이 같다

```json
{"session_id":"…","turn_id":"…","transcript_path":"…","cwd":"…",
 "hook_event_name":"PreToolUse","model":"gpt-5.6-sol","permission_mode":"bypassPermissions",
 "tool_name":"Bash","tool_input":{"command":"…"},"tool_use_id":"…"}
```

`PermissionRequest` 는 걸 필요 없었다. **`PreToolUse` 만으로 Bash·파일쓰기 모두 잡힌다.**

### item 실측

| type | 키 |
|---|---|
| `agent_message` | `id, type, text` |
| `command_execution` | `id, type, command, aggregated_output, exit_code, status` |
| `file_change` | `id, type, changes[{path, kind}], status` |
| `error` | `id, type, message` |

- 결과 본문은 `aggregated_output`(stdout+stderr 합본). `output` 필드는 없다.
- **`status` 는 실행이 끝났는지만 말한다.** 명령 성공 여부는 `exit_code` 로 봐야 한다.
- `file_change` 는 started/completed 양쪽에 오므로 completed 에서만 반영한다.
- `turn.completed.usage` = `input_tokens` · `cached_input_tokens` ·
  `cache_write_input_tokens` · `output_tokens` · `reasoning_output_tokens`. **비용은 없다.**

### ★ 훅 신뢰 경고가 대화에 섞인다

```json
{"type":"item.completed","item":{"id":"item_0","type":"error",
 "message":"`--dangerously-bypass-hook-trust` is enabled. …"}}
```

우리가 매 세션 일부러 켜는 것이라 **오류로 띄우면 진짜 오류가 묻힌다.**
어댑터에서 이 메시지만 걸러낸다.

## 결론

Codex 어댑터는 `main/adapters/codex-cli.ts`. 승인·이벤트·이어가기 모두 대응 완료.
남은 차이는 **비용 미제공** 하나뿐이며, 표시하려면 앱이 토큰×단가로 환산해야 한다.
