/**
 * Cliente HTTP central do frontend. Todas as chamadas à API REST passam por apiRequest.
 *
 * A URL base vem de VITE_API_BASE_URL (ex.: http://localhost:3001/api). Os caminhos são
 * relativos a ela: apiRequest('/health') chama http://localhost:3001/api/health.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequestOptions {
  /** Padrão: GET. */
  method?: HttpMethod
  headers?: HeadersInit
  /** Corpo serializado como JSON. Não use com GET. */
  body?: unknown
  /** Permite cancelar a requisição (ex.: ao desmontar um componente). */
  signal?: AbortSignal
}

/** Item de `error.details` nas respostas 400 do backend. */
export interface ApiErrorDetail {
  path: string
  message: string
}

/**
 * Códigos gerados pelo próprio cliente. Os demais códigos vêm da API
 * (ex.: validation_error, opportunity_not_found, database_unavailable).
 */
export type ClientErrorCode =
  | 'configuration_error'
  | 'network_error'
  | 'invalid_response'
  | 'http_error'

interface ApiErrorInit {
  /** Status HTTP; 0 quando não houve resposta (falha de conexão ou configuração). */
  status: number
  code: string
  message: string
  details?: ApiErrorDetail[]
  cause?: unknown
}

/** Erro de qualquer requisição feita por apiRequest. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorDetail[]

  constructor({ status, code, message, details = [], cause }: ApiErrorInit) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** true quando a requisição nem chegou a receber resposta do servidor. */
  get isNetworkError(): boolean {
    return this.code === 'network_error'
  }
}

function getBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!baseUrl) {
    throw new ApiError({
      status: 0,
      code: 'configuration_error',
      message: 'VITE_API_BASE_URL não está definida. Configure o arquivo .env.local do frontend.',
    })
  }
  // Remove barras finais: "http://localhost:3001/api//" vira "http://localhost:3001/api".
  return baseUrl.replace(/\/+$/, '')
}

function buildUrl(path: string): string {
  // O frontend consome somente a API configurada: URLs absolutas não são aceitas aqui.
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new ApiError({
      status: 0,
      code: 'configuration_error',
      message: 'apiRequest aceita apenas caminhos relativos à VITE_API_BASE_URL.',
    })
  }
  return `${getBaseUrl()}/${path.replace(/^\/+/, '')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrorDetail(value: unknown): value is ApiErrorDetail {
  return isRecord(value) && typeof value.path === 'string' && typeof value.message === 'string'
}

/** Formato de erro do backend: { success: false, status: "error", error: { code, message, details? } }. */
function readApiError(payload: unknown): Pick<ApiErrorInit, 'code' | 'message' | 'details'> | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null
  }
  const { code, message, details } = payload.error
  if (typeof code !== 'string' || typeof message !== 'string') {
    return null
  }
  return {
    code,
    message,
    details: Array.isArray(details) ? details.filter(isErrorDetail) : [],
  }
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return /\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType)
}

type ResponseBody =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'invalid_json'; error: unknown }

/** Lê o corpo da resposta: vazio (204 ou sem conteúdo), JSON, texto ou JSON inválido. */
async function readBody(response: Response): Promise<ResponseBody> {
  if (response.status === 204 || response.status === 205) {
    return { kind: 'empty' }
  }
  const text = await response.text()
  if (text.trim() === '') {
    return { kind: 'empty' }
  }
  if (!isJsonResponse(response)) {
    return { kind: 'text', value: text }
  }
  try {
    return { kind: 'json', value: JSON.parse(text) as unknown }
  } catch (error) {
    return { kind: 'invalid_json', error }
  }
}

function networkError(cause: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: 'network_error',
    message: 'Não foi possível conectar à API. Verifique se o servidor está em execução.',
    cause,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Faz uma requisição à API e devolve o JSON da resposta, sem alterar sua estrutura
 * (o envelope { success, data } do backend chega inteiro).
 *
 * - Respostas 204 ou sem corpo resolvem com undefined: nesses casos, inclua undefined em T.
 * - Respostas 2xx que não são JSON geram ApiError 'invalid_response'.
 * - Respostas de erro (4xx/5xx) geram ApiError com o código e a mensagem enviados pela API;
 *   se o corpo não seguir o formato do backend, o código é 'http_error'.
 * - Falha de conexão (API fora do ar, CORS, DNS) gera ApiError 'network_error' com status 0.
 * - Cancelamento via signal propaga o AbortError original.
 *
 * O tipo T não é validado em tempo de execução: ele descreve o contrato esperado.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', headers, body, signal } = options
  const url = buildUrl(path)

  const requestHeaders = new Headers(headers)
  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json')
  }

  const init: RequestInit = { method, headers: requestHeaders, signal }
  if (body !== undefined) {
    if (!requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json')
    }
    init.body = JSON.stringify(body)
  }

  let response: Response
  let responseBody: ResponseBody
  try {
    response = await fetch(url, init)
    responseBody = await readBody(response)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    throw networkError(error)
  }

  if (!response.ok) {
    const apiError = responseBody.kind === 'json' ? readApiError(responseBody.value) : null
    throw new ApiError({
      status: response.status,
      code: apiError?.code ?? 'http_error',
      message:
        apiError?.message ??
        `A API respondeu com erro HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}.`,
      details: apiError?.details,
    })
  }

  switch (responseBody.kind) {
    case 'empty':
      return undefined as T
    case 'json':
      return responseBody.value as T
    case 'invalid_json':
      throw new ApiError({
        status: response.status,
        code: 'invalid_response',
        message: 'A API retornou um JSON inválido.',
        cause: responseBody.error,
      })
    case 'text':
      throw new ApiError({
        status: response.status,
        code: 'invalid_response',
        message: 'A API retornou uma resposta que não é JSON.',
      })
  }
}
