import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

const PLUGIN = 'painel-uso'
const AGORA = Date.parse('2026-10-09T21:20:00Z') // 18:20 em São Paulo
const LIMITES: SessionRateLimit[] = [
  { kind: 'seven_day', percentUsed: 61.5, resetsAt: '2026-10-13T16:00:00Z' },
  { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-09T23:34:00Z' },
]
const SUPERFICIES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

function ambiente(on: On, limites: SessionRateLimit[] = LIMITES, colocado = true) {
  const clock = mock.clock(on, { now: AGORA })
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: AGORA, context: { window: 200_000 }, rateLimits: limites },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.open', () =>
    colocado
      ? { value: { isPlaced: true as const } }
      : { value: { isPlaced: false as const, reason: 'superfície sem painéis' } },
  )
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return clock
}

const inicio = { cwd: '/', surface: 'desktop' as const, isInteractive: true }

const pane = (bodyColumns: number, placement: 'dock' | 'inline') => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'painel-uso',
  props: {
    title: 'Uso e previsão',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
})

const fim = (turnId: string, durationMs: number, answer = 'ok') => ({
  answer,
  durationMs,
  isAborted: false,
  turnId,
  reason: 'answer' as const,
})

test('barra lateral mostra sessão e semanal, nessa ordem, em todas as superfícies', async ($, on) => {
  ambiente(on)
  await $.session.start(inicio)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...pane(32, 'dock'), surface })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const sessao = textos.indexOf('Sessão (5 h)')
    const semanal = textos.indexOf('Semanal')
    expect(sessao).toBeGreaterThanOrEqual(0)
    expect(semanal).toBeGreaterThan(sessao)
    expect(textos).toContain('34%')
    expect(textos).toContain('62%')
    expect(textos).toContain('↻ em 2 h 14 min · hoje 20:34')
    expect(textos).toContain('↻ em 3 d 18 h · ter 13:00')
    expect(await ui.find({ type: 'Button', key: 'linha' })).toBeDefined()
    await ui.unmount()
  }
})

test('modo compacto acima do prompt cabe numa linha por janela', async ($, on) => {
  ambiente(on)
  await $.session.start(inicio)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ ...pane(60, 'inline'), surface })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(textos).toContain('Sessão')
    expect(textos).toContain(' ↻2h14')
    expect(textos).toContain('Semana')
    expect(textos).toContain(' ↻3d18h')
    await ui.unmount()
  }
})

test('sem leitura ainda, avisa em vez de mostrar barras vazias', async ($, on) => {
  ambiente(on, [])
  await $.session.start(inicio)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Os limites aparecem após a próxima resposta.' })).toBeDefined()
  await ui.unmount()
})

test('a leitura empurrada pelo engine atualiza a barra e a cor', async ($, on) => {
  ambiente(on)
  await $.session.start(inicio)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-09T23:34:00Z' },
      { kind: 'seven_day', percentUsed: 75, resetsAt: '2026-10-13T16:00:00Z' },
    ],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: '92%' }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '75%' }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('a contagem anda sozinha com o painel parado', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '↻ em 2 h 14 min · hoje 20:34' })).toBeDefined()
  await clock.advance(61_000)
  expect(await ui.find({ type: 'Text', text: '↻ em 2 h 13 min · hoje 20:34' })).toBeDefined()
  await ui.unmount()
})

test('janela que já recarregou aparece como renovada', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  for (let h = 0; h < 3; h++) await clock.advance(3_600_000)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '↻ renovada · atualiza na próxima resposta' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0%' })).toBeDefined()
  await ui.unmount()
})

test('um pedido: cronômetro ao vivo e comparação sob a resposta', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'Explique o PID do forno', turnId: 't1' })
  await clock.advance(12_000)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '● executando' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0:12' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'estimativa inicial: ainda aprendendo' })).toBeDefined()
  await ui.unmount()

  const r = await $.turn.complete(fim('t1', 12_000, 'resposta'))
  expect(r.text).toMatch(/^⏱ Previsto 12 s · levou 12 s \(.+\) · aprendendo$/)

  const depois = await $.ui.mount({ ...pane(32, 'dock'), surface: 'terminal' })
  expect(await depois.find({ type: 'Text', text: '● executando' })).toBeUndefined()
  expect(await depois.find({ type: 'Text', text: 'Aguardando o próximo pedido.' })).toBeDefined()
  expect(await depois.find({ type: 'Text', text: 'Último pedido' })).toBeDefined()
  expect(await depois.find({ type: 'Text', text: 'previsto 12 s · levou 12 s' })).toBeDefined()
  expect(await depois.find({ type: 'Text', text: '1 pedido medido' })).toBeDefined()
  await depois.unmount()
})

test('aprende: depois de alguns pedidos, a previsão vira o tempo real', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  for (let i = 0; i < 5; i++) {
    await $.turn.start({ text: 'Resuma o relatório', turnId: `t${i}` })
    await clock.advance(20_000)
    await $.turn.complete(fim(`t${i}`, 20_000))
  }
  await $.turn.start({ text: 'Resuma o relatório', turnId: 't5' })
  await clock.advance(5_000)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: ' de ~0:20' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'estimativa inicial: ainda aprendendo' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '5 pedidos medidos' })).toBeDefined()
  await ui.unmount()
  await clock.advance(15_000)
  const r = await $.turn.complete(fim('t5', 20_000))
  expect(r.text).toMatch(/levou 20 s \(0%\) · erro médio \d+%$/)
})

test('pedido interrompido não entra no aprendizado', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'oi', turnId: 'a1' })
  await clock.advance(2_000)
  const r = await $.turn.complete({ answer: '', durationMs: 2_000, isAborted: true, turnId: 'a1', reason: 'aborted' })
  expect(r.text).toBe('')
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '● executando' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Nenhum pedido medido ainda.' })).toBeDefined()
  await ui.unmount()
})

test('o botão desliga a linha sob a resposta', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'terminal' })
  await ui.press({ key: 'linha' })
  expect((await ui.find({ type: 'Button', key: 'linha' }))?.text).toBe('○ Comparação sob a resposta')
  await ui.unmount()
  await $.turn.start({ text: 'oi', turnId: 'x1' })
  await clock.advance(3_000)
  const r = await $.turn.complete(fim('x1', 3_000, 'resposta'))
  expect(r.text).toBe('resposta')
})

test('/painel-uso responde com resumo e avisa quando a tela não mostra painéis', async ($, on) => {
  ambiente(on, LIMITES, false)
  await $.session.start(inicio)
  const r = await $.command.run({
    command: 'painel-uso',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toContain('Sessão (5 h): 34%')
  expect(r.text).toContain('recarrega em 2 h 14 min (hoje 20:34)')
  expect(r.text).toContain('Semanal: 62%')
  expect(r.text).toContain('painel não exibido nesta tela: superfície sem painéis')
})

test('turnos de subagentes não mexem na previsão', async ($, on) => {
  const clock = ambiente(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'pesquise', turnId: 'm1' })
  await clock.advance(1_000)
  const sub = await $.turn.complete({ ...fim('s1', 900, 'relatório'), agentId: 'agente-1' })
  expect(sub.text).toBe('relatório')
  const ui = await $.ui.mount({ ...pane(32, 'dock'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '● executando' })).toBeDefined()
  await ui.unmount()
})
