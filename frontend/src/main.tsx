import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import Shell from './components/Shell'
import { LangProvider } from './i18n'
import Landing from './pages/Landing'
import Workspace from './pages/Workspace'
import Architecture from './pages/Architecture'
import Dashboard from './pages/Dashboard'
import JudgmentPage from './pages/JudgmentPage'
import Upload from './pages/Upload'
import Experiments from './pages/Experiments'
import HistoryPage from './pages/History'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LangProvider><BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Landing />} />
          <Route path="research" element={<Workspace />} />
          <Route path="research/:runId" element={<Workspace />} />
          <Route path="architecture" element={<Architecture />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="upload" element={<Upload />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="judgments/:docId" element={<JudgmentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter></LangProvider>
  </React.StrictMode>,
)
