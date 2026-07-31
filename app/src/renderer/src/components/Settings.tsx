import { Bell, HelpCircle, Moon, Settings2, Sun, X } from 'lucide-react'
import type { DetectedRunner } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'

/** 라벨 옆 물음표. 설명은 평소엔 숨고 필요할 때만 나온다. */
function Hint({ text }: { text: string }): React.ReactElement {
  return (
    <span className="group/hint relative inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        className="text-overlay0 outline-none hover:text-subtext0 focus-visible:text-subtext0"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 w-56 -translate-y-1/2 rounded-lg bg-crust px-2.5 py-1.5 text-[11px] leading-relaxed text-subtext1 opacity-0 shadow-lg ring-1 ring-surface1 transition-opacity duration-100 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 motion-reduce:transition-none"
      >
        {text}
      </span>
    </span>
  )
}

const PROVIDER_LABEL: Record<string, string> = {
  'claude-cli': 'Claude',
  'codex-cli': 'Codex',
  'claude-agent-sdk': 'Claude (SDK)',
}

/** 앱 전역 설정. 흩어져 있던 토글을 한곳으로 모은다. */
export default function Settings({
  theme,
  onToggleTheme,
  notify,
  onToggleNotify,
  runners,
  onClose,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  notify: boolean
  onToggleNotify: (v: boolean) => void
  runners: DetectedRunner[]
  onClose: () => void
}) {
  const Row = ({
    label,
    hint,
    children,
  }: {
    label: string
    hint?: string
    children: React.ReactNode
  }): React.ReactElement => (
    <div className="grid grid-cols-[92px_1fr] items-start gap-x-4 py-2">
      <div className="flex items-center gap-1 pt-1 text-[12px] text-subtext0">
        <span>{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )

  /** 두 갈래 선택 — 스위치보다 지금 무엇인지가 분명하다 */
  const Choice = ({
    on,
    onPick,
    children,
  }: {
    on: boolean
    onPick: () => void
    children: React.ReactNode
  }): React.ReactElement => (
    <button
      onClick={onPick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition motion-reduce:transition-none ${
        on ? 'bg-mauve/20 text-mauve' : 'bg-base text-overlay1 hover:text-subtext0'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface0">
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface0">
            <Settings2 className="h-4 w-4 text-subtext0" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">Puppeteer</div>
            <div className="mt-0.5 text-[17px] text-text">설정</div>
          </div>
          <button
            onClick={onClose}
            title="닫기"
            className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-2 pt-2">
          <Row label="테마">
            <div className="flex gap-1.5">
              <Choice on={theme === 'dark'} onPick={() => theme !== 'dark' && onToggleTheme()}>
                <Moon className="h-3.5 w-3.5" /> 다크
              </Choice>
              <Choice on={theme === 'light'} onPick={() => theme !== 'light' && onToggleTheme()}>
                <Sun className="h-3.5 w-3.5" /> 라이트
              </Choice>
            </div>
          </Row>

          <Row
            label="알림"
            hint="창을 보고 있지 않을 때만 알립니다. 승인 대기는 응답이 없으면 자동으로 보류되므로 놓치면 작업이 멈춥니다."
          >
            <div className="flex gap-1.5">
              <Choice on={notify} onPick={() => onToggleNotify(true)}>
                <Bell className="h-3.5 w-3.5" /> 켜기
              </Choice>
              <Choice on={!notify} onPick={() => onToggleNotify(false)}>
                끄기
              </Choice>
            </div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-overlay1">
              승인 대기 · 세션 완료 · 실패 · 로그인 필요를 알립니다. 알림을 누르면 그 세션으로
              바로 이동합니다.
            </div>
          </Row>

          <Row label="실행 환경" hint="설치된 CLI 를 자동으로 찾은 결과입니다. 어디에 쓸지는 프로젝트마다 정합니다.">
            {runners.length === 0 ? (
              <div className="py-1 text-[12px] text-yellow">찾은 CLI 가 없습니다</div>
            ) : (
              <div className="space-y-1">
                {runners.map((r) => (
                  <div
                    key={r.id}
                    title={r.executable}
                    className="flex items-center gap-2 rounded-md bg-base px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="text-subtext1">
                      {PROVIDER_LABEL[r.provider] ?? r.provider}
                    </span>
                    <span className="text-overlay1">{runnerEnvironmentLabel(r)}</span>
                    {r.version && (
                      <span className="ml-auto font-mono text-[11px] text-overlay1">
                        {r.version}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Row>
        </div>

        <div className="px-5 pb-5 pt-3 text-[11px] leading-relaxed text-overlay1">
          에이전트와 세션 기록은 앱 데이터 폴더에 보관합니다. 메모리는 CLI 가 읽는 파일을 그대로
          씁니다 — 앱 없이 CLI 를 직접 실행해도 같은 설정이 적용됩니다.
        </div>
      </div>
    </div>
  )
}
