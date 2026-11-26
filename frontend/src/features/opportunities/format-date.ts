/** Fuso usado para exibir datas oficiais (convenção definida nas migrations do backend). */
const DISPLAY_TIME_ZONE = 'America/Sao_Paulo'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/**
 * Data e hora ISO (timestamptz, ex.: "2026-04-30T02:59:59.000Z") como DD/MM/AAAA no
 * horário de São Paulo. Retorna null se o texto não for uma data válida.
 */
export function formatDateTime(iso: string): string | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date)
}

/** Data de calendário YYYY-MM-DD como DD/MM/AAAA, sem passar por fuso horário. */
export function formatCalendarDate(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null
}
