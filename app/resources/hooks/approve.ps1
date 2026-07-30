# PreToolUse hook (Windows) — approve.sh 와 동일한 파일 프로토콜
param([Parameter(Mandatory=$true)][string]$Dir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$id  = "$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-$PID"
$req = Join-Path $Dir "$id.req.json"
$res = Join-Path $Dir "$id.res.json"

$input_json = [Console]::In.ReadToEnd()
[IO.File]::WriteAllText("$req.tmp", $input_json, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath "$req.tmp" -Destination $req -Force

for ($i = 0; $i -lt 2800; $i++) {
  if (Test-Path -LiteralPath $res) {
    [IO.File]::ReadAllText($res)
    Remove-Item -LiteralPath $req, $res -Force -ErrorAction SilentlyContinue
    exit 0
  }
  Start-Sleep -Milliseconds 100
}

Remove-Item -LiteralPath $req -Force -ErrorAction SilentlyContinue
'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"사용자 응답 대기 시간 초과. 이 작업은 보류되었습니다. 세션을 종료하지 말고, 다른 진행 가능한 작업을 하거나 사용자 지시를 기다리세요."}}'
