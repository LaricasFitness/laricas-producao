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

### Login e acesso às funções (`/api`)

O login é conferido no servidor (`api/sessao.mjs`): a senha vai por HTTPS, o servidor compara o
SHA-256 com `usuarios.senha_hash` usando a chave de serviço e grava um cookie `larc_sessao`
(HttpOnly, assinado com HMAC derivado da `SUPABASE_SERVICE_ROLE_KEY`, vale 7 dias e some ao fechar o
navegador). O `sessionStorage.usuario` guarda só nome, perfil e abas, sem senha.

- Toda rota em `api/` chama `exigirSessao()` (`api/_sessao.mjs`; arquivo com `_` não vira rota).
  A única exceção é a volta da autorização do Bling (`?acao=callback`), protegida pelo `state`.
- Trocar a senha ou desativar o usuário derruba as sessões dele na hora.
- Resposta 401 com o cabeçalho `X-Sessao: expirada` faz o App voltar para a tela de login
  (`src/lib/sessao.js`).
- A tabela `usuarios` não tem policy (`usuarios_fechar.sql`): o cadastro de usuários
  (Admin › Usuários) passa por `/api/sessao`, só para perfil `admin`.
- Com `npm run dev` puro (sem as funções), o login cai no jeito antigo e só funciona enquanto a
  tabela não estiver fechada. Para testar o login de verdade localmente, use `vercel dev`.

---

## Estrutura de menus

O sistema tem 5 menus. Cada um é uma página com abas internas.

| Menu | Arquivo | Abas |
|---|---|---|
| 📋 **Produção** | `ProducaoHub.jsx` | Registro, Planejamento, Análise, Log, Histórico, Rendimentos |
| 📥 **Estoque** | `EstoqueHub.jsx` | Situação, Conferência, Compras, Preços, Consumo, Pedidos à gráfica |
| 💰 **Custos** | `Precificacao.jsx` | Ficha de Custo, Markup e Canais, Ranking de Margem, Evolução do CMV, CMV do Mês, Custo de Preparações, Overhead, Criar Produto |
| 🚚 **Logística** | `Logistica.jsx` | Roteiros por zona, CSVs, Expedição (`Expedicao.jsx`), Delivery BV (`DeliveryBV.jsx`) |
| ⚙️ **Admin** | `Admin.jsx` | Cadastro de Embalagens, Previsão Delivery, Preparações, Composição e Embalagem, Canais, Custos Fixos, Sistema, Usuários |

As abas de Estoque e Custos reutilizam componentes exportados de
`Embalagens.jsx` e `MatPrimas.jsx` — esses dois arquivos **não são mais
páginas**, só hospedam componentes.

O menu **Financeiro** foi removido. Os arquivos `Fin*.jsx` continuam no
repositório mas não são importados por nada.

---

## Expedição (baixa dos pedidos enviados)

Logística › Expedição. O operador lê o código de barras da etiqueta de cada pacote que saiu
(câmera do celular ou leitor de código de barras) e dá baixa de todos de uma vez pela função
`api/expedicao.mjs`: na Shopify o pedido vira enviado (com rastreio, e-mail ao cliente opcional) e
arquivado; no Bling passa de "Em aberto" para "Atendido". Cada baixa fica em `expedicao_envios`.

- Leitura: rastreio (Correios, J&T), Data Matrix dos Correios, CEP (Lalamove), nº do pedido no Bling
  ou na loja. Pacote sem código (motoboy) é marcado à mão na lista.
- Picking: gerado ao **fechar o planejamento** (Produção › Planejamento › "PDF Produção"), com os números
  dos pedidos do dia na planilha do Bling (`src/lib/picking.js` → `acao:'picking'` busca cada pedido
  completo no Bling) e guardado em `expedicao_pickings` (`expedicao_pickings.sql`), um por dia de produção.
  O líder de expedição baixa o PDF em Expedição › Pickings (fica registrado quem baixou).
  PDF (`src/lib/pickingPDF.js`): A4 deitada com 2 pedidos lado a lado (linha de corte no meio), cada um
  com loja, cidade/UF, envio, itens, observação interna em destaque (preto e branco), "Obs. do cliente"
  = nota do pedido na Shopify (a observação do Bling não entra) e um QR Code com o nº do pedido no
  Bling, que a leitura da Expedição reconhece; no fim, o resumo da separação (soma de cada produto).
  O nome da loja vem de `/canais-venda` (escopo "Canais de venda" no app do Bling); sem o escopo,
  aparece "Shopify" (pelo nº da loja) ou o código da loja.
- Retirada na loja (Shopify, entrega `PICK_UP`): a baixa marca "pronto para retirada" (a Shopify avisa o
  cliente) e não arquiva; quando o cliente retira, marca-se "Retirado" na Shopify. Pedidos que a NF já deixa
  Atendido (B2B, venda direta, club) só geram aviso na leitura.
- Bling reabrindo pedidos: a integração Shopify do Bling reimporta o pedido a cada alteração na Shopify
  (envio, arquivamento, "entregue", edição) e reaplica o mapeamento de status "Pago → Em aberto"
  (Preferências › Integrações › Shopify › Integração automática de pedidos), por cima do "Atendido". O
  mapeamento só olha o status financeiro, então não há como configurar isso no Bling. Ao abrir a Expedição,
  `acao=pedidos` recoloca em "Atendido" (só no Bling) os pedidos com baixa registrada em `expedicao_envios`
  que o Bling reabriu, exceto os cancelados na Shopify.
- Notas do dia (Expedição › Notas do dia, só admin; `src/pages/ExpedicaoNotas.jsx`): para os pedidos do
  picking (ou números digitados) mostra a natureza que a regra pede e o motivo (`acao:'notas'`, só leitura),
  gera as notas como rascunho pendente no Bling (`rascunhoNF`) e transmite à Sefaz (`transmitirNF`) só as
  que conferem, depois do clique e da confirmação. A conferência é refeita no servidor antes de transmitir.
  Natureza não vem no pedido: o Bling escolhe ao gerar a nota (consumidor final para PF, venda de mercadoria
  para PJ, a do cadastro para clientes com ST); o sistema compara com a regra:
  - Shopify: pago qualquer valor → venda ao consumidor final; total R$ 0 com cupom `voucher*` → bonificação
    (R$ 0 sem voucher ou pedido não achado na Shopify: manual).
  - Clube/Rits/Mercado Livre → consumidor final; Marketing e Bonificação → bonificação (unificada, não usar
    "Saída em bonificação"); Reenvio → reposição de mercadoria; Laricas Experience → entrega de presente.
  - Revenda e Venda Direta → qualquer natureza de venda do cadastro do cliente (ST já configurado lá).
    Consignação é sempre manual, pelo Bling. Loja sem regra: manual.
  - Gerar a nota pela API deixa o pedido Atendido: com a nota pendente, o sistema devolve para Em aberto
    (quem deixa Atendido é a baixa). O Bling numera a nota já no rascunho.
  - Escopos do app do Bling: Notas Fiscais, Emissão de NF-e, Pedidos de Venda, Gerenciar Pedidos de Venda e
    Gerenciar situações dos Pedidos de Venda (mudar escopo derruba o acesso: reconectar).
- Acesso ao Bling: app privado (Central de Extensões › Área do integrador), OAuth com
  `enable-jwt: 1`. Os tokens ficam em `integracao_tokens` (RLS sem política: só a função lê,
  com a service_role). O refresh token vale 30 dias e se renova a cada uso.
- Variáveis no Vercel: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
  e as da Shopify (o app precisa de `write_orders` e `write_merchant_managed_fulfillment_orders`).

## Delivery BV (contagem diária do delivery)

Logística › Delivery BV. Substitui a planilha "Controle Delivery" e o print no grupo. Todo fim de dia,
depois do restock, o operador lança por SKU a **geladeira** do delivery da Bela Vista, a **armazenagem**
(estoque da produção) e a **validade mais antiga** da armazenagem. Uma linha por (data, sku) em
`delivery_contagens` (`delivery_contagens.sql`); lançar de novo no mesmo dia corrige.

- Produtos: os SKUs de `delivery_previsao` com rótulo ativo e em temporada (Admin › Previsão delivery).
- **Demanda a cobrir**: soma da previsão do dia seguinte até a próxima contagem. Conta-se de segunda a
  quinta, então a de quinta cobre Sex+Sáb+Dom+Seg (como na planilha; são os mesmos dias da produção de sexta no Planejamento).
- **Falta produzir** = demanda a cobrir − (geladeira + armazenagem), quando positivo.
- **Valor em estoque** = quantidade × CMV direto do produto (`cmv_historico`, mês mais recente, com
  rendimento real quando houver; sem overhead), o mesmo da Ficha do Produto.
- Demanda e custo ficam congelados na linha da contagem: o histórico não muda quando a previsão ou o custo mudam.
- Não debita estoque de MP/embalagem.
- **Planejamento**: a coluna Delivery de um dia de produção vem pré-preenchida com a previsão desse dia
  (sexta = Sex+Sáb+Dom+Seg) **menos o estoque da contagem da véspera** (geladeira + armazenagem), nunca
  abaixo de zero. A contagem de quinta cobre os mesmos dias da produção de sexta. Sem contagem na véspera
  (ex.: produção de segunda) ou SKU não contado, vale a previsão cheia. Um aviso acima da tabela diz qual
  regra foi usada, e passar o mouse no Delivery mostra a conta de cada produto. O valor continua editável.

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

`rendimento_real_medio` = média ponderada dos últimos 10 lançamentos de `preparacao_rendimento`
(Σ peso ÷ Σ receitas, `src/lib/rendimento.js`). Lança-se na tela Rendimentos ou, junto com a
impressão das etiquetas de validade (Produção › Etiquetas), nos campos opcionais "nº de receitas"
e "peso total"; a etiqueta guarda o `rendimento_id` (`etiquetas_rendimento.sql`). A tela avisa
quando já há lançamento da mesma preparação no dia, para não contar a mesma produção duas vezes.

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

**Real** — para matéria-prima, `estoque inicial + compras − estoque final`,
em R$ (`src/lib/cmv.js`). Não depende de ficha nenhuma. Para embalagem
(sem controle de estoque por contagem), produção × ficha + percentual de
perda configurável (`perda_embalagem_pct`, padrão 2%).

- Estoque final = contagem do **último dia do mês**. Sem ela, saldo calculado
  (última contagem + entradas − consumo registrado), marcado "calc.".
- Valorização **PEPS**: o estoque vale o preço das compras mais recentes.
- **Fechamento automático**: a partir do dia 5 do mês seguinte, o primeiro
  acesso ao sistema grava o mês em `fechamento_cmv` (congelado). O estoque
  final de um mês é o inicial do seguinte.
- Compra lançada depois do fechamento com data de mês fechado entra no
  primeiro mês aberto ("de mês anterior"). Editar/excluir compra de mês
  fechado é bloqueado — reabrir o mês na tela CMV do Mês (admin).

A aba **CMV do Mês** mostra real e teórico lado a lado. A diferença é
desperdício, rendimento pior que o cadastrado ou lançamento faltando.

---

## Estoque

**Matéria-prima** usa saldo guardado em `materias_primas.estoque_atual`.
Pode ficar **negativo** de propósito: negativo sinaliza compra não lançada ou
consumo a maior. Truncar em zero apagaria o rombo — foi um bug real.

A **data da NF não diz quando a mercadoria chegou**. Compra com data igual ou
anterior à última contagem pergunta se já estava contada; a resposta fica em
`mp_compras.entrou_no_saldo`. Ao excluir ou editar, vale o momento do
lançamento: compra lançada antes da contagem já foi absorvida por ela.

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

**Delivery** — `delivery_previsao` (previsão por dia da semana), `delivery_contagens`
(contagem diária da Bela Vista)

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

- Políticas RLS liberam tudo para a chave anônima nas demais tabelas — o login protege a
  interface e as funções `/api`, não o banco (a tabela `usuarios` já é fechada)
- `MatPrimas.jsx` tem ~2.800 linhas e hospeda componentes de duas páginas
- Conferência de embalagem lê o custo atual do cadastro, enquanto a de MP
  congela o custo na data — comparação entre meses fica distorcida
- Estoque de produto acabado não é controlado (a contagem do Delivery BV é só
  acompanhamento), então o CMV é custo de produção, não custo de vendas
