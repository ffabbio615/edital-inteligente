/**
 * Valor monetário no formato brasileiro, na moeda informada (código ISO de 3 letras,
 * ex.: "BRL" → "R$ 150.000,00"). Retorna null se o valor ou a moeda forem inválidos.
 */
export function formatMoney(amount: number, currency: string): string | null {
  if (!Number.isFinite(amount)) {
    return null
  }
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)
  } catch {
    return null
  }
}
