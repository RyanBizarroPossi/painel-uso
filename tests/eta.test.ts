import { expect, test } from 'claude-code/testing'

import { erroMedio, prever, previsaoInicial, refinar } from '../hooks/eta'
import type { Amostra, Contexto } from '../hooks/eta'
import {
  barra,
  contagem,
  contagemCurta,
  desvio,
  duracao,
  horaLocal,
  linhaComparacao,
  percentual,
  relogio,
} from '../hooks/formato'

const CTX: Contexto = { chars: 30, modelo: 'm', esforco: 'high' }

const amostra = (ms: number, extra: Partial<Amostra> = {}): Amostra => ({
  fim: 0,
  ms,
  chars: 30,
  modelo: 'm',
  esforco: 'high',
  passos: 1,
  ferramentas: 0,
  ...extra,
})

test('sem histórico usa o palpite inicial', () => {
  const p = prever([], CTX)
  expect(p.nivel).toBe('inicial')
  expect(p.ms).toBe(previsaoInicial(30).ms)
  expect(p.baixoMs).toBeLessThan(p.ms)
  expect(p.altoMs).toBeGreaterThan(p.ms)
})

test('com pedidos parecidos usa a mediana do grupo mais específico', () => {
  const h = [20_000, 22_000, 18_000, 21_000, 19_000].map(ms => amostra(ms))
  const p = prever(h, CTX)
  expect(p.nivel).toBe('modelo+esforço+tamanho')
  expect(p.ms).toBeGreaterThanOrEqual(19_000)
  expect(p.ms).toBeLessThanOrEqual(21_000)
})

test('cai para grupos mais amplos quando falta dado', () => {
  const h = [10_000, 11_000, 12_000, 13_000].map(ms => amostra(ms, { esforco: 'low' }))
  expect(prever(h, CTX).nivel).toBe('modelo+tamanho')
  expect(prever(h, { ...CTX, modelo: 'outro' }).nivel).toBe('tamanho')
  expect(prever(h, { chars: 5_000, modelo: 'outro', esforco: 'high' }).nivel).toBe('geral')
})

test('pedidos recentes pesam mais que os antigos', () => {
  const antigos = Array.from({ length: 20 }, () => amostra(10_000))
  const recentes = Array.from({ length: 12 }, () => amostra(60_000))
  expect(prever([...antigos, ...recentes], CTX).ms).toBe(60_000)
})

test('reestima quando o pedido passa do previsto', () => {
  const h = [60_000, 65_000, 70_000, 20_000, 21_000, 22_000].map(ms => amostra(ms))
  const p = prever(h, CTX)
  expect(p.ms).toBeLessThan(30_000)
  const r = refinar(h, CTX, 30_000, 0, p)
  expect(r.ms).toBeGreaterThanOrEqual(60_000)
  expect(r.baixoMs).toBeGreaterThanOrEqual(30_000)
})

test('sem pedidos tão longos, extrapola a partir do decorrido', () => {
  const h = [10_000, 11_000, 12_000, 13_000].map(ms => amostra(ms))
  const r = refinar(h, CTX, 40_000, 0, prever(h, CTX))
  expect(r.ms).toBe(Math.round(40_000 * 1.3 + 5_000))
})

test('quando começa a usar ferramentas, compara com pedidos que também usaram', () => {
  const com = [90_000, 100_000, 110_000].map(ms => amostra(ms, { ferramentas: 3 }))
  const sem = [10_000, 11_000, 12_000, 13_000].map(ms => amostra(ms))
  const h = [...com, ...sem]
  const p = prever(h, CTX)
  expect(p.ms).toBeLessThan(20_000)
  expect(refinar(h, CTX, 5_000, 1, p).ms).toBeGreaterThanOrEqual(90_000)
  expect(refinar(h, CTX, 5_000, 0, p)).toEqual(p)
})

test('erro médio usa só pedidos com previsão e pede no mínimo 3', () => {
  const h = [
    amostra(10_000, { previstoMs: 12_000 }),
    amostra(10_000, { previstoMs: 8_000 }),
    amostra(20_000, { previstoMs: 20_000 }),
    amostra(30_000),
  ]
  expect(erroMedio(h)).toBe(13)
  expect(erroMedio(h.slice(0, 2))).toBeNull()
})

test('formatos em pt-BR', () => {
  expect(duracao(45_000)).toBe('45 s')
  expect(duracao(65_000)).toBe('1 min 05 s')
  expect(duracao(3_780_000)).toBe('1 h 03 min')
  expect(relogio(23_000)).toBe('0:23')
  expect(relogio(3_723_000)).toBe('1:02:03')
  expect(contagem(2 * 3_600_000 + 14 * 60_000 + 30_000)).toBe('2 h 14 min')
  expect(contagem((3 * 24 + 4) * 3_600_000)).toBe('3 d 4 h')
  expect(contagem(30_000)).toBe('menos de 1 min')
  expect(contagemCurta(2 * 3_600_000 + 14 * 60_000)).toBe('2h14')
  expect(percentual(61.5)).toBe('62%')
  expect(percentual(0.5)).toBe('0,5%')
  expect(desvio(30)).toBe('+30%')
  expect(desvio(-12)).toBe('−12%')
  const b = barra(0.34, 10)
  expect(b.cheio.length).toBe(3)
  expect(b.vazio.length).toBe(7)
  expect(barra(0.001, 10).cheio.length).toBe(1)
  expect(linhaComparacao(40_000, 52_000, 23, false)).toBe(
    '⏱ Previsto 40 s · levou 52 s (+30%) · erro médio 23%',
  )
})

test('hora local de São Paulo (UTC−3)', () => {
  const agora = Date.parse('2026-10-09T21:20:00Z') // sexta, 18:20 em SP
  expect(horaLocal(Date.parse('2026-10-09T23:34:00Z'), agora)).toBe('hoje 20:34')
  expect(horaLocal(Date.parse('2026-10-10T06:10:00Z'), agora)).toBe('amanhã 03:10')
  expect(horaLocal(Date.parse('2026-10-13T16:00:00Z'), agora)).toBe('ter 13:00')
  expect(horaLocal(Date.parse('2026-10-30T16:00:00Z'), agora)).toBe('30/10 13:00')
})
