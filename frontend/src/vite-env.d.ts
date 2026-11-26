/// <reference types="vite/client" />

// Variáveis de ambiente do frontend. Só variáveis com prefixo VITE_ chegam ao navegador,
// portanto nenhuma delas pode conter segredo.
interface ImportMetaEnv {
  /** URL base da API REST, ex.: http://localhost:3001/api */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
