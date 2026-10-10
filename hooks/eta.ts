// Previsão do tempo de um pedido a partir do histórico real.
//
// Cada pedido concluído vira uma amostra. A previsão usa as amostras mais
// parecidas com o pedido novo (mesmo modelo, esforço e tamanho do texto),
// caindo para grupos mais amplos quando faltam dados. Amostras recentes pesam
// mais (meia-vida de 15 pedidos), então a previsão acompanha mudanças de ritmo.
// Ao fim de cada pedido o real entra no histórico: é assim que a precisão melhora.

export type Amostra = {
  /** Quando terminou (ms desde a época). */
  fim: number
  /** Duração real do pedido, em ms. */
  ms: number
  /** Tamanho do texto enviado, em caracteres. */
  chars: number
  modelo: string
  esforco: string
  passos: number
  ferramentas: number
  /** O que foi previsto no início, para medir o erro. */
  previstoMs?: number
}

export type Contexto = { chars: number; modelo: string; esforco: string }

export type Nivel =
  | 'modelo+esforço+tamanho'
  | 'modelo+tamanho'
  | 'modelo'
  | 'tamanho'
  | 'geral'
  | 'inicial'

export type Previsao = {
  ms: number
  baixoMs: number
  altoMs: number
  nivel: Nivel
  /** Quantas amostras sustentam a previsão. */
  base: number
}

/** Mínimo de amostras para um grupo valer como base. */
export const MIN_AMOSTRAS = 4
const JANELA = 60
const MEIA_VIDA = 15

export function classeTamanho(chars: number): number {
  if (chars < 80) return 0
  if (chars < 400) return 1
  if (chars < 1500) return 2
  return 3
}

type Ponderado = { v: number; w: number }

function quantil(valores: readonly Ponderado[], q: number): number {
  const ordenados = [...valores].sort((a, b) => a.v - b.v)
  const total = ordenados.reduce((soma, x) => soma + x.w, 0)
  let acumulado = 0
  for (const x of ordenados) {
    acumulado += x.w
    if (acumulado >= q * total) return x.v
  }
  return ordenados[ordenados.length - 1]?.v ?? 0
}

/** As últimas amostras do grupo, com peso maior para as mais recentes. */
function ponderar(amostras: readonly Amostra[]): Ponderado[] {
  const recentes = amostras.slice(-JANELA)
  const n = recentes.length
  return recentes.map((a, i) => ({ v: a.ms, w: Math.pow(0.5, (n - 1 - i) / MEIA_VIDA) }))
}

const NIVEIS: readonly { nivel: Nivel; filtro: (a: Amostra, c: Contexto) => boolean }[] = [
  {
    nivel: 'modelo+esforço+tamanho',
    filtro: (a, c) =>
      a.modelo === c.modelo &&
      a.esforco === c.esforco &&
      classeTamanho(a.chars) === classeTamanho(c.chars),
  },
  {
    nivel: 'modelo+tamanho',
    filtro: (a, c) => a.modelo === c.modelo && classeTamanho(a.chars) === classeTamanho(c.chars),
  },
  { nivel: 'modelo', filtro: (a, c) => a.modelo === c.modelo },
  { nivel: 'tamanho', filtro: (a, c) => classeTamanho(a.chars) === classeTamanho(c.chars) },
  { nivel: 'geral', filtro: () => true },
]

/** Sem histórico: um palpite pelo tamanho do texto, com faixa larga. */
export function previsaoInicial(chars: number): Previsao {
  const ms = Math.min(90_000, Math.max(8_000, 12_000 + chars * 12))
  return { ms, baixoMs: Math.round(ms * 0.5), altoMs: Math.round(ms * 2.5), nivel: 'inicial', base: 0 }
}

export function prever(historico: readonly Amostra[], ctx: Contexto): Previsao {
  for (const { nivel, filtro } of NIVEIS) {
    const grupo = historico.filter(a => filtro(a, ctx))
    if (grupo.length >= MIN_AMOSTRAS) {
      const p = ponderar(grupo)
      return {
        ms: Math.round(quantil(p, 0.5)),
        baixoMs: Math.round(quantil(p, 0.25)),
        altoMs: Math.round(quantil(p, 0.75)),
        nivel,
        base: Math.min(grupo.length, JANELA),
      }
    }
  }
  return previsaoInicial(ctx.chars)
}

/**
 * Reestima durante a execução. Já passou `decorridoMs`: entre os pedidos
 * parecidos, só contam os que duraram mais que isso (os outros já teriam
 * acabado). Se o pedido começou a usar ferramentas, só contam os que também
 * usaram. Sem dados suficientes e já acima da estimativa, extrapola.
 */
export function refinar(
  historico: readonly Amostra[],
  ctx: Contexto,
  decorridoMs: number,
  ferramentas: number,
  atual: Previsao,
): Previsao {
  const usouFerramentas = ferramentas > 0
  const relevante = usouFerramentas || decorridoMs >= atual.ms * 0.75
  if (!relevante) return atual

  const sobreviventes = historico.filter(
    a => a.ms > decorridoMs && (!usouFerramentas || a.ferramentas > 0),
  )
  const mesmoModelo = sobreviventes.filter(a => a.modelo === ctx.modelo)
  const grupo = mesmoModelo.length >= 3 ? mesmoModelo : sobreviventes

  if (grupo.length >= 3) {
    const p = ponderar(grupo)
    const ms = Math.max(Math.round(quantil(p, 0.5)), decorridoMs + 2_000)
    return {
      ms,
      baixoMs: Math.max(Math.round(quantil(p, 0.25)), decorridoMs),
      altoMs: Math.max(Math.round(quantil(p, 0.75)), ms),
      nivel: atual.nivel,
      base: Math.min(grupo.length, JANELA),
    }
  }

  if (decorridoMs < atual.ms) return atual
  const ms = Math.round(decorridoMs * 1.3 + 5_000)
  return { ms, baixoMs: decorridoMs, altoMs: Math.round(decorridoMs * 2 + 10_000), nivel: atual.nivel, base: atual.base }
}

/**
 * Erro percentual absoluto médio (|real − previsto| / real) das `n` últimas
 * amostras que tinham previsão, pulando as `pular` mais recentes.
 */
export function erroMedio(historico: readonly Amostra[], n = 20, pular = 0): number | null {
  const comPrevisao = historico.filter(a => typeof a.previstoMs === 'number' && a.ms > 0)
  const fim = comPrevisao.length - pular
  const selecao = comPrevisao.slice(Math.max(0, fim - n), Math.max(0, fim))
  if (selecao.length < 3) return null
  const soma = selecao.reduce((s, a) => s + Math.abs(a.ms - (a.previstoMs ?? a.ms)) / a.ms, 0)
  return Math.round((soma / selecao.length) * 100)
}

/** Descarta o que não parece uma amostra (dado salvo por versão antiga, etc.). */
export function amostraValida(x: unknown): x is Amostra {
  if (typeof x !== 'object' || x === null) return false
  const a = x as Record<string, unknown>
  return (
    typeof a.fim === 'number' &&
    typeof a.ms === 'number' &&
    a.ms > 0 &&
    typeof a.chars === 'number' &&
    typeof a.modelo === 'string' &&
    typeof a.esforco === 'string' &&
    typeof a.passos === 'number' &&
    typeof a.ferramentas === 'number'
  )
}
