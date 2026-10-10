// Formatação em pt-BR. Não depende de Intl: o ambiente do mod pode não ter
// a base de fusos, então a hora local usa um deslocamento fixo.

/** Fuso de São Paulo: UTC−3 (sem horário de verão desde 2019). */
export const FUSO_MINUTOS = -180

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MENOS = '−'

const dois = (n: number) => String(n).padStart(2, '0')

/** "45 s", "2 min 05 s", "1 h 03 min" */
export function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min ${dois(s % 60)} s`
  return `${Math.floor(min / 60)} h ${dois(min % 60)} min`
}

/** Cronômetro: "0:23", "12:05", "1:02:03" */
export function relogio(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  return h > 0 ? `${h}:${dois(m)}:${dois(seg)}` : `${m}:${dois(seg)}`
}

/** Tempo até recarregar: "3 d 4 h", "2 h 14 min", "12 min", "menos de 1 min" */
export function contagem(ms: number): string {
  if (ms < 60_000) return 'menos de 1 min'
  const total = Math.floor(ms / 60_000)
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m > 0 ? `${h} h ${dois(m)} min` : `${h} h`
  return `${m} min`
}

/** Versão curta para o modo compacto: "3d4h", "2h14", "12min", "<1min" */
export function contagemCurta(ms: number): string {
  if (ms < 60_000) return '<1min'
  const total = Math.floor(ms / 60_000)
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${dois(m)}`
  return `${m}min`
}

const diaLocal = (ms: number) => Math.floor((ms + FUSO_MINUTOS * 60_000) / 86_400_000)

/** "hoje 21:40", "amanhã 03:10", "qui 13:00", "21/10 13:00" */
export function horaLocal(alvoMs: number, agoraMs: number): string {
  const d = new Date(alvoMs + FUSO_MINUTOS * 60_000)
  const hhmm = `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`
  const delta = diaLocal(alvoMs) - diaLocal(agoraMs)
  if (delta === 0) return `hoje ${hhmm}`
  if (delta === 1) return `amanhã ${hhmm}`
  if (delta > 1 && delta < 7) return `${DIAS[d.getUTCDay()] ?? ''} ${hhmm}`
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)} ${hhmm}`
}

/** Barra de progresso em células: a parte cheia e a vazia. */
export function barra(fracao: number, largura: number): { cheio: string; vazio: string } {
  const n = Math.max(1, Math.floor(largura))
  const f = Math.min(1, Math.max(0, Number.isFinite(fracao) ? fracao : 0))
  let cheio = Math.round(f * n)
  if (f > 0 && cheio === 0) cheio = 1
  return { cheio: '━'.repeat(cheio), vazio: '━'.repeat(n - cheio) }
}

/** "34%", "0,5%", "100%" */
export function percentual(p: number): string {
  if (p > 0 && p < 10 && !Number.isInteger(p)) return `${p.toFixed(1).replace('.', ',')}%`
  return `${Math.round(p)}%`
}

/** "+30%", "−12%", "0%" */
export function desvio(pct: number): string {
  if (pct > 0) return `+${pct}%`
  if (pct < 0) return `${MENOS}${Math.abs(pct)}%`
  return '0%'
}

export function rotulo(kind: string): { longo: string; curto: string } {
  switch (kind) {
    case 'five_hour':
      return { longo: 'Sessão (5 h)', curto: 'Sessão' }
    case 'seven_day':
      return { longo: 'Semanal', curto: 'Semana' }
    case 'seven_day_opus':
      return { longo: 'Semanal · Opus', curto: 'Opus' }
    case 'seven_day_sonnet':
      return { longo: 'Semanal · Sonnet', curto: 'Sonnet' }
    case 'spend_limit':
      return { longo: 'Limite de gasto', curto: 'Gasto' }
    default: {
      const texto = kind.replace(/_/g, ' ')
      return { longo: texto, curto: texto.slice(0, 7) }
    }
  }
}

/** Sessão primeiro, depois a semanal, depois o resto. */
export function ordem(kind: string): number {
  if (kind === 'five_hour') return 0
  if (kind === 'seven_day') return 1
  return 2
}

/** Cor do tema conforme o uso: laranja do Claude, aviso, erro. */
export function corDoUso(p: number): 'claude' | 'warning' | 'error' {
  if (p >= 90) return 'error'
  if (p >= 70) return 'warning'
  return 'claude'
}

/** Cor do acerto da previsão: perto (até 20%), razoável (até 50%), longe. */
export function corDoDesvio(pct: number): 'success' | 'warning' | 'error' {
  const a = Math.abs(pct)
  if (a <= 20) return 'success'
  if (a <= 50) return 'warning'
  return 'error'
}

/** A linha que aparece sob cada resposta. */
export function linhaComparacao(
  previstoMs: number,
  realMs: number,
  erroMedioPct: number | null,
  aprendendo: boolean,
): string {
  const pct = previstoMs > 0 ? Math.round(((realMs - previstoMs) / previstoMs) * 100) : 0
  const partes = [`⏱ Previsto ${duracao(previstoMs)} · levou ${duracao(realMs)} (${desvio(pct)})`]
  if (erroMedioPct !== null) partes.push(`erro médio ${erroMedioPct}%`)
  else if (aprendendo) partes.push('aprendendo')
  return partes.join(' · ')
}
