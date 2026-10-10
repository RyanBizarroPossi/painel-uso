# painel-uso

Mod para o Claude: painel com o uso da **sessão (5 h)** e do **limite semanal**, o tempo até cada um recarregar e uma **previsão de tempo por pedido** que aprende comparando o previsto com o real.

```
Sessão (5 h)                 34%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↻ em 2 h 09 min · hoje 20:34

Semanal                      62%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↻ em 3 d 18 h · ter 13:00

Previsão            ● executando
0:23 de ~0:44
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
faixa 41 s a 47 s

Precisão
Último pedido               +21%
previsto 43 s · levou 52 s
Erro médio (20 últimos): 50%
```

## O que faz
- Barras de uso com as cores do tema (laranja; amarelo a partir de 70%; vermelho a partir de 90%) e contagem até recarregar com a hora local.
- Ao enviar um pedido: estimativa com faixa e cronômetro. Reajusta se o Claude começa a usar ferramentas ou passa do previsto.
- No fim, uma linha sob a resposta: `⏱ Previsto 40 s · levou 52 s (+30%) · erro médio 23%`. O tempo real entra no histórico e melhora as próximas previsões.
- Ao lado da conversa quando há espaço; em telas estreitas, versão compacta acima do prompt.
- `/painel-uso` reabre o painel.

## Instalar
**App do Claude:** Customize → Plugins → Add → Add marketplace → Add from a repository → `RyanBizarroPossi/painel-uso` → adicionar **painel-uso**.

**Aba Code do app:** botão **+** ao lado do prompt → Plugins → Add plugin → **painel-uso** (com o marketplace já adicionado).

**Terminal (Claude Code):**
```
/plugin install painel-uso --marketplace RyanBizarroPossi/painel-uso
```
Responda `y` para adicionar o marketplace e escolha o escopo *user*.

## Como funciona
- Os limites vêm do próprio Claude (os números da status line), sem acesso à rede. Aparecem em planos com assinatura, após a primeira resposta.
- A previsão usa a mediana ponderada dos pedidos parecidos (modelo, esforço, tamanho do texto), com mais peso nos recentes. Sai da estimativa inicial após ~4 pedidos.
- Histórico (até 400 pedidos) fica no armazenamento local do plugin. Fuso fixo UTC−3 em `hooks/formato.ts`.

## Limitações
- Não roda no chat comum: hooks de plugin só rodam nas conversas de tarefa e na aba Code.
- Precisa de versão recente do app (API de mods em early access).
- A previsão não sabe antes o tamanho da resposta nem quantas ferramentas serão usadas; pedidos longos erram mais.

## Desenvolvimento
```
claude plugin validate .
claude plugin test .
```
