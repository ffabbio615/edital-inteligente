import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import PublicLayout from './layouts/PublicLayout'
import HomePage from './pages/HomePage'
import OpportunityDetailPage from './pages/OpportunityDetailPage'

/**
 * Rotas públicas:
 * - /                    listagem (filtros e página na query string)
 * - /oportunidades/:id   detalhes de uma oportunidade
 * Qualquer outro caminho volta para a Home.
 */
function App() {
  return (
    <BrowserRouter>
      <PublicLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/oportunidades/:id" element={<OpportunityDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PublicLayout>
    </BrowserRouter>
  )
}

export default App
