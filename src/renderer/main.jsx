import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initTheme } from './theme'
import { initMotion } from './motion'
import { initInterfaceScale } from './interfaceScale'
import { I18nProvider, initLanguage } from './i18n'
import './fonts.css'
import './index.css'

initTheme()
initMotion()
initInterfaceScale()
initLanguage()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
)
