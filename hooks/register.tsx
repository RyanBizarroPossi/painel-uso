import { atom, read, update } from 'claude-code'
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  EngineInterface,
  Register,
  RenderElement,
  SessionRateLimit,
  TextProps,
} from 'claude-code'

import type { Comparacao, Estatisticas, Execucao, Janela } from '../types'
import { amostraValida, erroMedio, prever, refinar } from './eta'
import type { Amostra, Contexto, Nivel } from './eta'
import {
  barra,
  contagem,
  contagemCurta,
  corDoDesvio,
  corDoUso,
  desvio,
  duracao,
  horaLocal,
  linhaComparacao,
  ordem,
  percentual,
  relogio,
  rotulo,
} from './formato'

const PANE = 'painel-uso'
const TITULO = 'Uso e previsão'
const LIMITE_HISTORICO = 400
const ABERTURA = { id: PANE, title: TITULO, columns: 34, rows: 5 } as const

const leitura = atom({ plugin: 'painel-uso', key: 'leitura' } as const, null)
const agora = atom({ plugin: 'painel-uso', key: 'agora' } as const, 0)
const execucao = atom({ plugin: 'painel-uso', key: 'execucao' } as const, null)
const ultima = atom({ plugin: 'painel-uso', key: 'ultima' } as const, null)
const estatisticas = atom({ plugin: 'painel-uso', key: 'estatisticas' } as const, {
  amostras: 0,
  erroMedioPct: null,
  erroAnteriorPct: null,
})
const mostrarLinha = atom({ plugin: 'painel-uso', key: 'mostrarLinha' } as const, true)
const faixaOculta = atom({ plugin: 'painel-uso', key: 'faixaOculta' } as const, false)

type Pecas = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

type Dados = {
  janelas: Janela[]
  agoraMs: number
  colunas: number
  exec: Execucao | null
  ultimaComp: Comparacao | null
  stats: Estatisticas
  linha: boolean
  alternar: () => Promise<void>
}

const normalizar = (j: SessionRateLimit): Janela =>
  j.resetsAt === undefined
    ? { kind: j.kind, percentUsed: j.percentUsed }
    : { kind: j.kind, percentUsed: j.percentUsed, resetsAt: j.resetsAt }

const calcularEstatisticas = (h: readonly Amostra[]): Estatisticas => ({
  amostras: h.length,
  erroMedioPct: erroMedio(h, 20, 0),
  erroAnteriorPct: erroMedio(h, 20, 20),
})

const previsaoDe = (x: Execucao) => ({
  ms: x.estimadoMs,
  baixoMs: x.baixoMs,
  altoMs: x.altoMs,
  nivel: x.nivel as Nivel,
  base: 0,
})

// Variáveis do módulo: recomeçam a cada carga e são refeitas do $.store no
// session.start (que dispara de novo a cada recarga do mod).
let historico: Amostra[] = []
let modelo = '?'
let esforco = '-'
let ultimoTick = 0
let ultimaLeituraUso = 0
let ultimoRefino = 0
let tiques = 0
let turnoAtivo: string | null = null

async function gravarLeitura($: EngineInterface, limites: readonly SessionRateLimit[]) {
  if (limites.length === 0) return // mantém a última leitura; a contagem segue local
  const lidoEm = await $.clock.now()
  await update($, leitura, () => ({ janelas: limites.map(normalizar), lidoEm }))
}

async function lerUso($: EngineInterface) {
  const uso = await $.session.usage()
  await gravarLeitura($, uso.rateLimits)
}

// Um relógio só: redesenha a cada segundo durante um pedido, a cada 30 s parado
// (parado, os tiques intermediários voltam sem nenhuma chamada ao engine).
async function tick($: EngineInterface) {
  tiques += 1
  if (turnoAtivo === null && tiques % 30 !== 0) return
  const t = await $.clock.now()
  const x = turnoAtivo === null ? null : await read($, execucao)
  if (x !== null || t - ultimoTick >= 30_000) {
    ultimoTick = t
    if (x !== null && t - ultimoRefino >= 3_000) {
      ultimoRefino = t
      const ctx: Contexto = { chars: x.chars, modelo: x.modelo, esforco: x.esforco }
      const nova = refinar(historico, ctx, t - x.inicio, x.ferramentas, previsaoDe(x))
      if (Math.abs(nova.ms - x.estimadoMs) > Math.max(1_000, x.estimadoMs * 0.05)) {
        await update($, execucao, atual =>
          atual !== null && atual.turnId === x.turnId
            ? { ...atual, estimadoMs: nova.ms, baixoMs: nova.baixoMs, altoMs: nova.altoMs, refinada: true }
            : atual,
        )
      }
    }
    await update($, agora, () => t)
  }
  if (t - ultimaLeituraUso >= 60_000) {
    ultimaLeituraUso = t
    await lerUso($)
  }
  await atualizarStatus($)
}

// Uma linha para a status line: sempre visível sob o prompt.
async function atualizarStatus($: EngineInterface) {
  const t = await $.clock.now()
  const l = await read($, leitura)
  const x = await read($, execucao)
  const partes: string[] = []
  for (const j of [...(l?.janelas ?? [])].sort((a, b) => ordem(a.kind) - ordem(b.kind))) {
    if (ordem(j.kind) > 1) continue
    const reset = j.resetsAt === undefined ? Number.NaN : Date.parse(j.resetsAt)
    const renovada = Number.isFinite(reset) && reset <= t
    const pct = renovada ? 0 : j.percentUsed
    const fim = !Number.isFinite(reset) ? '' : renovada ? ' ↻ok' : ` ↻${contagemCurta(reset - t)}`
    partes.push(`${rotulo(j.kind).curto} ${percentual(pct)}${fim}`)
  }
  if (x !== null) partes.push(`⏱ ${relogio(Math.max(0, t - x.inicio))} de ~${relogio(x.estimadoMs)}`)
  $.ui.status(partes.length > 0 ? partes.join(' · ') : undefined)
}

async function resumoTexto($: EngineInterface): Promise<string> {
  const t = await $.clock.now()
  const l = await read($, leitura)
  const u = await read($, ultima)
  const s = await read($, estatisticas)
  const linhas: string[] = []
  const janelas = [...(l?.janelas ?? [])].sort((a, b) => ordem(a.kind) - ordem(b.kind))
  if (janelas.length === 0) linhas.push('Limites: aparecem após a próxima resposta.')
  for (const j of janelas) {
    const reset = j.resetsAt === undefined ? Number.NaN : Date.parse(j.resetsAt)
    const renovada = Number.isFinite(reset) && reset <= t
    const pct = renovada ? 0 : Math.max(0, Math.min(100, j.percentUsed))
    const b = barra(pct / 100, 20)
    const fim = !Number.isFinite(reset)
      ? ''
      : renovada
        ? ' · renovada'
        : ` · recarrega em ${contagem(reset - t)} (${horaLocal(reset, t)})`
    linhas.push(`${rotulo(j.kind).longo}: ${percentual(pct)} ${b.cheio}${b.vazio.replace(/━/g, '─')}${fim}`)
  }
  if (u !== null) {
    linhas.push(`Último pedido: previsto ${duracao(u.previstoMs)} · levou ${duracao(u.realMs)} (${desvio(u.desvioPct)})`)
  }
  if (s.erroMedioPct !== null) linhas.push(`Erro médio (20 últimos): ${s.erroMedioPct}% · ${s.amostras} pedidos medidos`)
  else if (s.amostras > 0) linhas.push(`${s.amostras} ${s.amostras === 1 ? 'pedido medido' : 'pedidos medidos'}`)
  return linhas.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const salvo = await $.store.get('historico')
    historico = Array.isArray(salvo) ? salvo.filter(amostraValida).slice(-LIMITE_HISTORICO) : []
    const linhaSalva = await $.store.get('mostrarLinha')
    await update($, mostrarLinha, () => linhaSalva !== false)
    await update($, estatisticas, () => calcularEstatisticas(historico))

    const emAndamento = await read($, execucao)
    turnoAtivo = emAndamento === null ? null : emAndamento.turnId

    const t = await $.clock.now()
    ultimoTick = t
    ultimaLeituraUso = t
    await update($, agora, () => t)
    try {
      await lerUso($)
    } catch {
      // sem leitura ainda: o painel avisa e o session.measure preenche depois
    }

    await $.command.register({ name: 'painel-uso', description: 'Abre o painel de uso e previsão' })
    void $.ui.open({ ...ABERTURA })
    $.clock.every(1_000, () => {
      void tick($).catch(() => undefined)
    })

    return next(e)
  })

  // Abre o painel e também responde com um resumo em texto, que aparece
  // mesmo onde a superfície não mostra painéis.
  on('command.run', { command: 'painel-uso' }, async $ => {
    const aberto = await $.ui.open({ ...ABERTURA })
    await update($, faixaOculta, () => false)
    try {
      await lerUso($)
    } catch {
      // segue com a última leitura
    }
    try {
      await $.ui.scroll({ in: PANE, to: 'start' })
    } catch {
      // superfície sem rolagem: segue
    }
    const resumo = await resumoTexto($)
    const pane = await $.ui.panes().then(
      lista => lista.find(p => p.id === PANE),
      () => undefined,
    )
    const aviso = !aberto.isPlaced
      ? `\n\n(painel não exibido nesta tela: ${aberto.reason})`
      : pane !== undefined && !pane.isShown
        ? '\n\n(painel aberto atrás de outra aba)'
        : ''
    return { text: resumo + aviso }
  })

  // Os limites chegam empurrados pelo engine: após cada resposta e quando uma
  // janela anda um ponto inteiro. Nada de rede: são os números da status line.
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('rateLimits')) await gravarLeitura($, e.rateLimits)
    return r
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    const t = await $.clock.now()
    const ctx: Contexto = { chars: e.text.length, modelo, esforco }
    const p = prever(historico, ctx)
    ultimoRefino = t
    turnoAtivo = e.turnId
    await update($, execucao, () => ({
      turnId: e.turnId,
      inicio: t,
      previstoMs: p.ms,
      estimadoMs: p.ms,
      baixoMs: p.baixoMs,
      altoMs: p.altoMs,
      nivel: p.nivel,
      passos: 0,
      ferramentas: 0,
      chars: ctx.chars,
      modelo,
      esforco,
      refinada: false,
    }))
    await update($, agora, () => t)
    return r
  })

  // O primeiro passo revela o modelo e o esforço de verdade; se mudaram,
  // a previsão é refeita na hora (ainda no início do pedido).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      try {
        const novoModelo = e.model
        const novoEsforco = e.effort === undefined ? '-' : String(e.effort)
        modelo = novoModelo
        esforco = novoEsforco
        await update($, execucao, x => {
          if (x === null || x.turnId !== e.turnId) return x
          const mudou = e.index === 0 && (x.modelo !== novoModelo || x.esforco !== novoEsforco)
          if (!mudou) return { ...x, passos: x.passos + 1 }
          const p = prever(historico, { chars: x.chars, modelo: novoModelo, esforco: novoEsforco })
          return {
            ...x,
            passos: x.passos + 1,
            modelo: novoModelo,
            esforco: novoEsforco,
            previstoMs: p.ms,
            estimadoMs: p.ms,
            baixoMs: p.baixoMs,
            altoMs: p.altoMs,
            nivel: p.nivel,
          }
        })
      } catch {
        // observador: nunca atrapalha o pedido
      }
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, execucao, x => (x === null ? x : { ...x, ferramentas: x.ferramentas + 1 }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    const x = await read($, execucao)
    if (x === null || x.turnId !== e.turnId) return r

    const t = await $.clock.now()
    turnoAtivo = null
    await update($, execucao, () => null)
    await update($, agora, () => t)
    if (e.reason !== 'answer' || e.isAborted || e.durationMs <= 0) return r

    const amostra: Amostra = {
      fim: t,
      ms: e.durationMs,
      chars: x.chars,
      modelo: x.modelo,
      esforco: x.esforco,
      passos: x.passos,
      ferramentas: x.ferramentas,
      previstoMs: x.previstoMs,
    }
    historico = [...historico, amostra].slice(-LIMITE_HISTORICO)
    await $.store.set('historico', historico)

    const stats = calcularEstatisticas(historico)
    const desvioPct = Math.round(((e.durationMs - x.previstoMs) / x.previstoMs) * 100)
    await update($, estatisticas, () => stats)
    await update($, ultima, () => ({
      previstoMs: x.previstoMs,
      realMs: e.durationMs,
      desvioPct,
      em: t,
      nivel: x.nivel,
    }))

    if (!(await read($, mostrarLinha))) return r
    return {
      ...r,
      text: linhaComparacao(x.previstoMs, e.durationMs, stats.erroMedioPct, x.nivel === 'inicial'),
    }
  })

  // Faixa fixa acima do prompt: a versão compacta, visível em qualquer tela.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, faixaOculta))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const [l, t, x, u, s, linha] = await Promise.all([
      read($, leitura),
      read($, agora),
      read($, execucao),
      read($, ultima),
      read($, estatisticas),
      read($, mostrarLinha),
    ])
    const dados: Dados = {
      janelas: [...(l?.janelas ?? [])].sort((a, b) => ordem(a.kind) - ordem(b.kind)),
      agoraMs: t > 0 ? t : await $.clock.now(),
      colunas: Math.max(30, Math.min(100, e.props.bodyColumns - 8)),
      exec: x,
      ultimaComp: u,
      stats: s,
      linha,
      alternar: async () => undefined,
    }
    return (
      <Box>
        <Box flexGrow={1}>{compacto({ Box, Text, Button }, dados)}</Box>
        <Button key="ocultar-faixa" plain onPress={() => update($, faixaOculta, () => true)}>
          ×
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [l, t, x, u, s, linha] = await Promise.all([
      read($, leitura),
      read($, agora),
      read($, execucao),
      read($, ultima),
      read($, estatisticas),
      read($, mostrarLinha),
    ])
    const dados: Dados = {
      janelas: [...(l?.janelas ?? [])].sort((a, b) => ordem(a.kind) - ordem(b.kind)),
      agoraMs: t > 0 ? t : await $.clock.now(),
      colunas: Math.max(16, Math.min(80, e.props.bodyColumns)),
      exec: x,
      ultimaComp: u,
      stats: s,
      linha,
      alternar: async () => {
        const valor = await update($, mostrarLinha, atual => !atual)
        await $.store.set('mostrarLinha', valor)
      },
    }
    const pecas: Pecas = { Box, Text, Button }
    return e.props.placement === 'inline' ? compacto(pecas, dados) : lateral(pecas, dados)
  })
}

// ---------- desenho: barra lateral (dock) ----------

function lateral(p: Pecas, d: Dados): RenderElement {
  const { Box, Text, Button } = p
  return (
    <Box flexDirection="column" gap={1}>
      {d.janelas.length === 0 ? (
        <Text dimColor>Os limites aparecem após a próxima resposta.</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          {d.janelas.map(j => blocoJanela(p, j, d.agoraMs, d.colunas))}
        </Box>
      )}
      {blocoPrevisao(p, d)}
      {blocoHistorico(p, d)}
      <Button key="linha" plain onPress={d.alternar}>
        {d.linha ? '◉ Comparação sob a resposta' : '○ Comparação sob a resposta'}
      </Button>
    </Box>
  )
}

function blocoJanela(p: Pecas, j: Janela, agoraMs: number, colunas: number): RenderElement {
  const { Box, Text } = p
  const r = rotulo(j.kind)
  const reset = j.resetsAt === undefined ? Number.NaN : Date.parse(j.resetsAt)
  const temReset = Number.isFinite(reset)
  const renovada = temReset && reset <= agoraMs
  const pct = renovada ? 0 : Math.max(0, Math.min(100, j.percentUsed))
  const cor = corDoUso(pct)
  const b = barra(pct / 100, colunas)
  const sub = !temReset
    ? 'sem horário de recarga informado'
    : renovada
      ? '↻ renovada · atualiza na próxima resposta'
      : `↻ em ${contagem(reset - agoraMs)} · ${horaLocal(reset, agoraMs)}`
  return (
    <Box flexDirection="column">
      <Box width={colunas} justifyContent="space-between">
        <Text bold>{r.longo}</Text>
        <Text bold color={cor}>
          {percentual(pct)}
        </Text>
      </Box>
      <Box>
        {b.cheio.length > 0 && <Text color={cor}>{b.cheio}</Text>}
        {b.vazio.length > 0 && <Text color="inactive">{b.vazio}</Text>}
      </Box>
      <Text dimColor>{sub}</Text>
    </Box>
  )
}

function blocoPrevisao(p: Pecas, d: Dados): RenderElement {
  const { Box, Text } = p
  const x = d.exec
  if (x === null) {
    return (
      <Box flexDirection="column">
        <Text bold>Previsão</Text>
        <Text dimColor>
          {d.stats.amostras === 0
            ? 'Envie um pedido: a estimativa aparece aqui e melhora a cada resposta.'
            : 'Aguardando o próximo pedido.'}
        </Text>
      </Box>
    )
  }
  const decorrido = Math.max(0, d.agoraMs - x.inicio)
  const acima = decorrido > x.estimadoMs
  const cor = acima ? 'warning' : 'claude'
  const b = barra(decorrido / Math.max(1, x.estimadoMs), d.colunas)
  return (
    <Box flexDirection="column">
      <Box width={d.colunas} justifyContent="space-between">
        <Text bold>Previsão</Text>
        <Text color={cor}>● executando</Text>
      </Box>
      <Box>
        <Text bold>{relogio(decorrido)}</Text>
        <Text dimColor>{acima ? ` · passou de ~${relogio(x.estimadoMs)}` : ` de ~${relogio(x.estimadoMs)}`}</Text>
      </Box>
      <Box>
        {b.cheio.length > 0 && <Text color={cor}>{b.cheio}</Text>}
        {b.vazio.length > 0 && <Text color="inactive">{b.vazio}</Text>}
      </Box>
      <Text dimColor>
        faixa {duracao(x.baixoMs)} a {duracao(x.altoMs)}
      </Text>
      {x.passos + x.ferramentas > 0 && (
        <Text dimColor>
          {x.passos} {x.passos === 1 ? 'passo' : 'passos'} · {x.ferramentas}{' '}
          {x.ferramentas === 1 ? 'ferramenta' : 'ferramentas'}
        </Text>
      )}
      {x.nivel === 'inicial' && <Text dimColor>estimativa inicial: ainda aprendendo</Text>}
      {x.refinada && <Text dimColor>ajustada durante a execução</Text>}
    </Box>
  )
}

function blocoHistorico(p: Pecas, d: Dados): RenderElement {
  const { Box, Text } = p
  const u = d.ultimaComp
  const s = d.stats
  const tendencia =
    s.erroMedioPct !== null && s.erroAnteriorPct !== null
      ? s.erroMedioPct <= s.erroAnteriorPct - 2
        ? ' ↓ melhorando'
        : s.erroMedioPct >= s.erroAnteriorPct + 2
          ? ' ↑ piorando'
          : ' estável'
      : ''
  return (
    <Box flexDirection="column">
      <Text bold>Precisão</Text>
      {u === null ? (
        <Text dimColor>Nenhum pedido medido ainda.</Text>
      ) : (
        <Box flexDirection="column">
          <Box width={d.colunas} justifyContent="space-between">
            <Text>Último pedido</Text>
            <Text color={corDoDesvio(u.desvioPct)}>{desvio(u.desvioPct)}</Text>
          </Box>
          <Text dimColor>
            previsto {duracao(u.previstoMs)} · levou {duracao(u.realMs)}
          </Text>
        </Box>
      )}
      {s.erroMedioPct !== null ? (
        <Text dimColor>
          Erro médio (20 últimos): {s.erroMedioPct}%{tendencia}
        </Text>
      ) : (
        s.amostras > 0 && <Text dimColor>Erro médio aparece após 3 pedidos.</Text>
      )}
      {s.amostras > 0 && (
        <Text dimColor>
          {s.amostras} {s.amostras === 1 ? 'pedido medido' : 'pedidos medidos'}
        </Text>
      )}
    </Box>
  )
}

// ---------- desenho: compacto (acima do prompt, telas estreitas) ----------

function compacto(p: Pecas, d: Dados): RenderElement {
  const { Box, Text } = p
  const larguraBarra = Math.max(6, d.colunas - 8 - 6 - 8)
  const x = d.exec
  const u = d.ultimaComp
  return (
    <Box flexDirection="column">
      {d.janelas.length === 0 && <Text dimColor>Limites após a próxima resposta.</Text>}
      {d.janelas.map(j => {
        const reset = j.resetsAt === undefined ? Number.NaN : Date.parse(j.resetsAt)
        const renovada = Number.isFinite(reset) && reset <= d.agoraMs
        const pct = renovada ? 0 : Math.max(0, Math.min(100, j.percentUsed))
        const cor = corDoUso(pct)
        const b = barra(pct / 100, larguraBarra)
        const fim = !Number.isFinite(reset) ? '' : renovada ? ' ↻ok' : ` ↻${contagemCurta(reset - d.agoraMs)}`
        return (
          <Box>
            <Box width={8}>
              <Text bold>{rotulo(j.kind).curto}</Text>
            </Box>
            <Box width={6}>
              <Text color={cor}>{percentual(pct)}</Text>
            </Box>
            {b.cheio.length > 0 && <Text color={cor}>{b.cheio}</Text>}
            {b.vazio.length > 0 && <Text color="inactive">{b.vazio}</Text>}
            <Text dimColor>{fim}</Text>
          </Box>
        )
      })}
      {x !== null ? (
        <Text>
          ⏱ {relogio(Math.max(0, d.agoraMs - x.inicio))} de ~{relogio(x.estimadoMs)} · faixa{' '}
          {duracao(x.baixoMs)} a {duracao(x.altoMs)}
        </Text>
      ) : u !== null ? (
        <Text dimColor>
          ⏱ último: {duracao(u.previstoMs)} → {duracao(u.realMs)} ({desvio(u.desvioPct)})
          {d.stats.erroMedioPct !== null ? ` · erro médio ${d.stats.erroMedioPct}%` : ''}
        </Text>
      ) : (
        <Text dimColor>⏱ a previsão aparece no próximo pedido</Text>
      )}
    </Box>
  )
}
