import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initTheme } from './lib/theme'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 폰트가 조용히 시스템 글꼴로 떨어지면 눈치채기 어렵다. 실패는 남긴다.
void document.fonts.ready.then(() => {
  if (!document.fonts.check('14px Pretendard')) {
    console.warn('Pretendard 를 불러오지 못했습니다 — 시스템 폰트로 표시됩니다')
  }
})
