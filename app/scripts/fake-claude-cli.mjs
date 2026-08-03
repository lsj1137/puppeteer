const line = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

line({
  type: 'system',
  subtype: 'init',
  session_id: 'e2e-cli-session',
  cwd: process.cwd(),
  model: 'fake-model',
  permissionMode: 'bypassPermissions',
  claude_code_version: 'e2e',
  apiKeySource: 'e2e',
  tools: [],
})
line({
  type: 'assistant',
  message: { id: 'e2e-message', content: [{ type: 'text', text: 'E2E 응답 완료' }] },
})
line({
  type: 'result',
  subtype: 'success',
  is_error: false,
  terminal_reason: 'completed',
  result: 'E2E 응답 완료',
  total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 1 },
})
