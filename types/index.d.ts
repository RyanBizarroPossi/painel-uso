/** Uma janela de limite como o engine a informa (five_hour, seven_day, ...). */
export type Janela = { kind: string; percentUsed: number; resetsAt?: string }

/** A última leitura dos limites e quando foi feita (ms desde a época). */
export type Leitura = { janelas: Janela[]; lidoEm: number }

/** O pedido em andamento: início, previsão original e a estimativa ao vivo. */
export type Execucao = {
  turnId: string
  inicio: number
  previstoMs: number
  estimadoMs: number
  baixoMs: number
  altoMs: number
  nivel: string
  passos: number
  ferramentas: number
  chars: number
  modelo: string
  esforco: string
  refinada: boolean
}

/** O último pedido concluído: previsto x real. */
export type Comparacao = {
  previstoMs: number
  realMs: number
  desvioPct: number
  em: number
  nivel: string
}

/** Precisão acumulada: erro médio dos 20 últimos e dos 20 anteriores. */
export type Estatisticas = {
  amostras: number
  erroMedioPct: number | null
  erroAnteriorPct: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'painel-uso': {
      leitura: Leitura | null
      agora: number
      execucao: Execucao | null
      ultima: Comparacao | null
      estatisticas: Estatisticas
      mostrarLinha: boolean
      faixaOculta: boolean
    }
  }
}
