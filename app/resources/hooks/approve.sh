#!/usr/bin/env bash
# PreToolUse hook — 승인 요청을 파일로 남기고 앱의 응답을 기다린다.
# $1 = 승인 디렉토리 (러너 환경 기준 경로)
set -u
DIR="${1:?approval dir required}"
mkdir -p "$DIR"

ID="$(date +%s%N)-$$"
REQ="$DIR/$ID.req.json"
RES="$DIR/$ID.res.json"

# 부분 기록을 앱이 읽지 않도록 임시 파일에 쓴 뒤 원자적으로 이동
cat > "$REQ.tmp" && mv "$REQ.tmp" "$REQ"

# 앱에 설정한 hook timeout 보다 살짝 짧게 잡는다
LIMIT_TICKS=2800   # 0.1s * 2800 = 280s
TICK=0
while [ "$TICK" -lt "$LIMIT_TICKS" ]; do
  if [ -f "$RES" ]; then
    cat "$RES"
    rm -f "$REQ" "$RES"
    exit 0
  fi
  sleep 0.1
  TICK=$((TICK + 1))
done

# 만료 — 세션을 죽이지 않고 보류시킨다
rm -f "$REQ"
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"사용자 응답 대기 시간 초과. 이 작업은 보류되었습니다. 세션을 종료하지 말고, 다른 진행 가능한 작업을 하거나 사용자 지시를 기다리세요."}}
JSON
