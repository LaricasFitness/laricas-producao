[README (1).md](https://github.com/user-attachments/files/33166134/README.1.md)
# Laricas Produção

Sistema interno de produção, estoque e custos da **Laricas Fitness** — marca de
doces proteicos e zero açúcar (pães de mel, barras, bolinhos, potinhos, latas).

**Produção:** https://laricas-producao.vercel.app

---

## Stack

| | |
|---|---|
| Front-end | React 18 + Vite |
| Banco / Auth | Supabase (PostgreSQL) |
| Deploy | Vercel (push na `main` → deploy automático) |
| Bibliotecas | jsPDF + autoTable, recharts, @dnd-kit, lucide-react, jszip |

Variáveis de ambiente em `.env` (ver `.env.example`):
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

```bash
npm install
npm run dev      # desenvolvimento
npm run build    # produção
```

---

## Estrutura de menus

O sistema tem 5 menus. Cada um é uma página com abas internas.

| Menu | Arquivo | Abas |
|---|---|---|
| 📋 **Produção** | `ProducaoHub.jsx` | Registro, Planejamento, Análise, Log, Histórico, Rendimentos |
| 📥 **Estoque** | `EstoqueHub.jsx` | Situação, Conferência, Compras, Preços, Consumo, Pedidos à gráfica |
| 💰 **Custos** | `Precificacao.jsx` | Ficha de Custo, Markup e Canais, Ranking de Margem, Evolução do CMV, CMV do Mês, Custo de Preparações, Overhead, Criar Produto |
| 🚚 **Logística** | `Logistica.jsx` | Roteiros por zona, CSVs |
| ⚙️ **Admin** | `Admin.jsx` | Cadastro de Embalagens, Previsão Delivery, Preparações, Composição e Embalagem, Canais, Custos Fixos, Sistema, Usuários |

As abas de Estoque e Custos reutilizam componentes exportados de
`Embalagens.jsx` e `MatPrimas.jsx` — esses dois arquivos **não são mais
páginas**, só hospedam componentes.

O menu **Financeiro** foi removido. Os arquivos `Fin*.jsx` continuam no
repositório mas não são importados por nada.

---

## Conceitos do domínio

Entender estes quatro pontos evita a maior parte dos erros.

### 1. Rendimento das preparações

Cada preparação (massa, recheio, creme, cobertura) tem:

- `rendimento_estimado` — **soma dos ingredientes** da receita
- `perda_percentual` — perda de processo (sobra de panela, resíduo)
- `rendimento_real_medio` — pesagem real do que saiu, **já líquida**

A regra, aplicada em **todos** os cálculos:

```js
rendLiquido = rendimento_real_medio
  ? rendimento_real_medio                              // já é líquido
  : rendimento_estimado * (1 - perda_percentual/100)   // estimado é bruto
```

Aplicar a perda sobre o rendimento real é dupla contagem — foi um bug real.

### 2. Composição de produto

`produto_composicao` guarda o **peso no produto acabado**, nunca o peso cru.
O rendimento das preparações também é de produto acabado, então os dois lados
falam a mesma língua e não há conversão no meio.

A coluna `quantidade_crua` é legado e vale sempre o mesmo que
`quantidade_por_unidade`.

### 3. Embalagem por produto

`produto_embalagem` define quais embalagens cada SKU consome e quantas.
A lata de minis, por exemplo, leva 8 filmes.

O **rótulo** é o próprio registro em `embalagens` do SKU (1 por unidade).
`categoria_embalagem` é só o padrão da categoria, usado como fallback para
produtos sem vínculo próprio.

### 4. Preço médio

Matéria-prima e embalagem usam **média ponderada dos últimos 30 dias** de
compras, com fallback para todo o histórico quando não há compra na janela.
**Nunca grava zero** — zerar apagaria o custo em todas as fichas.

MP: `recalcularCustoMP()` em `MatPrimas.jsx`
Embalagem: `recalcularCustoEmbalagem()` em `lib/data.js`

---

## Dois caminhos de CMV

O sistema calcula custo por dois métodos independentes, que devem convergir.

**Teórico** — produção registrada × ficha técnica. É o CMV por produto.

**Real** — para matéria-prima, inventário físico:
`estoque inicial + compras − estoque final`. Não depende de ficha nenhuma.
Para embalagem, produção × ficha + percentual de perda configurável.

A aba **CMV do Mês** mostra os dois lado a lado. A diferença na matéria-prima
é desperdício, rendimento pior que o cadastrado ou lançamento faltando.

---

## Estoque

**Matéria-prima** usa saldo guardado em `materias_primas.estoque_atual`.
Pode ficar **negativo** de propósito: negativo sinaliza compra não lançada ou
consumo a maior. Truncar em zero apagaria o rombo — foi um bug real.

**Embalagem** não guarda saldo. É recalculado por `calcularEstoqueCronologico()`
a partir do último inventário, somando `recebimento_itens` e subtraindo
`producao_diaria`. O campo `estoque_atual` de embalagens existe mas não é a
fonte de verdade.

### O que debita estoque

Só o **registro de produção** (`Producao.jsx`), nunca o planejamento:

- o rótulo do produto — 1 por unidade
- as embalagens vinculadas — × a quantidade do vínculo
- a matéria-prima — pela ficha técnica
- o desperdício da fase 6, quando vinculado a uma matéria-prima

---

## Tabelas principais

**Produção** — `producao_diaria`, `producao_interna` (fases e desperdício),
`planejamentos`, `planejamento_itens`, `log_acoes`

**Fichas** — `preparacoes`, `preparacao_composicao` (aceita sub-preparação),
`preparacao_rendimento`, `produto_composicao`, `produto_embalagem`

**Estoque MP** — `materias_primas`, `mp_compras`, `mp_consumos`,
`conferencia_mp`, `mp_inventarios`

**Estoque embalagem** — `embalagens`, `categoria_embalagem`, `inventarios`,
`conferencia_estoque`, `recebimentos`, `recebimento_itens`,
`pedidos_grafica`, `pedido_itens`

**Custos** — `overhead_producao`, `canal_custos`, `preco_produto_canal`,
`cmv_historico`, `produto_simulacoes`

**Sistema** — `configuracoes`, `usuarios`

Tabelas `fin_*` pertencem ao módulo financeiro desativado.

---

## Convenções

Toda tabela nova precisa de política RLS — sem ela os `insert` falham em
silêncio pelo cliente:

```sql
ALTER TABLE nome ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON nome FOR ALL USING (true) WITH CHECK (true);
```

Consultas aninhadas no Supabase às vezes devolvem 404 — quando acontecer,
separe em queries independentes.

O `npm run build` local é mais permissivo que o build da Vercel. Antes de
commitar, vale validar cada arquivo com o esbuild direto:

```bash
npx esbuild --loader:.jsx=jsx --bundle=false --outfile=/dev/null src/pages/Arquivo.jsx
```

Migrações de banco são arquivos `.sql` aplicados manualmente no editor do
Supabase. Não há ferramenta de migração.

---

## Pontos em aberto

- Políticas RLS liberam tudo para a chave anônima — o login protege a
  interface, não o banco
- `MatPrimas.jsx` tem ~2.800 linhas e hospeda componentes de duas páginas
- Conferência de embalagem lê o custo atual do cadastro, enquanto a de MP
  congela o custo na data — comparação entre meses fica distorcida
- Estoque de produto acabado não é controlado, então o CMV é custo de
  produção, não custo de vendas
