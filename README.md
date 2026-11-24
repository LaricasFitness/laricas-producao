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

O menu **Financeiro** é `FinanceiroHub.jsx`: DRE (`FinanceiroDRE.jsx`, regras em `src/lib/dreLaricas.js`), Margem
por canal e Importar e classificar (leitura dos arquivos e das plataformas em `src/lib/dre.js`). Os arquivos
`Fin*.jsx` são do módulo financeiro antigo e não são importados por nada.

### DRE Laricas (Financeiro › DRE)

Uma tela por mês, abas na ordem do fechamento:
- **DRE**: competência ou caixa; cada linha abre os lançamentos que a somam; indicadores (CMV %, CMO, prime cost,
  margem de contribuição, EBITDA, ponto de equilíbrio); exporta para Excel.
- **Competência**: receitas por canal em **Receitas** (bruto no faturamento, descontos/promoções nas deduções,
  comissão da plataforma nas despesas variáveis comerciais, pedidos). "Preencher" usa o faturamento das plataformas
  (`dre_canal_competencia`) e as vendas do Bling de Revenda e Venda direta (`api/financeiro`, ação `pedidos`:
  pedidos atendidos + em aberto, sem a loja "nenhuma"). Despesas: contas a pagar do Bling pela competência. CMV:
  fechamento de estoque (`fechamento_cmv`) + embalagem de envio (pedidos × `configuracoes.dre_embalagem_envio`) +
  auxiliares. Compras de estoque e Tráfego Pago pagos no Bling ficam só no caixa (`so_caixa`). **Manuais**: taxas
  descontadas na venda, mídia da planilha da agência, acertos sem caixa, reclassificações (valor negativo), anuidades ÷ 12.
- **Caixa**: extrato do Bling (`dre_caixa_lancamentos`).
- Classificação de cada lançamento: à mão (`dre_classificacao`, pelo id do Bling, sobrevive à atualização) > regra
  de categoria + fornecedor > regra só da categoria (`dre_regras`); contas em `dre_plano` (aba **Plano e regras**).
- **Auditoria**: ponte competência → caixa por linha (receitas por recebedor, porque Pagar.me e Mercado Pago misturam
  canais); a soma das diferenças fecha exatamente. Saldos de cada banco (`dre_saldos`) conferidos com o movimento do
  Bling; ajustes de saldo do Bling destacados.
- **Fechamento**: checklist e cadeado (`dre_mes`, as duas visões, guarda os totais). Fechado, os gatilhos bloqueiam
  receitas, manuais, saldos e lançamentos do mês. Só admin reabre.

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
  Exceção: pedido da Shopify Atendido no Bling (NF emitida direto no Bling fecha o pedido) que ainda não foi
  enviado na Shopify e não tem baixa registrada (`faltaShopify`, conferido na Shopify): entra na lista de baixa,
  que marca o envio na Shopify e não mexe no Bling.
- Bling reabrindo pedidos: a integração Shopify do Bling reimporta o pedido a cada alteração na Shopify
  (envio, arquivamento, "entregue", edição) e reaplica o mapeamento de status "Pago → Em aberto"
  (Preferências › Integrações › Shopify › Integração automática de pedidos), por cima do "Atendido". O
  mapeamento só olha o status financeiro, então não há como configurar isso no Bling. Ao abrir a Expedição,
  `acao=pedidos` recoloca em "Atendido" (só no Bling) os pedidos com baixa registrada em `expedicao_envios`
  que o Bling reabriu, exceto os cancelados na Shopify.
- Etapas (abas da Expedição, na ordem do processo): 1. Picking (gerado ao fechar o planejamento) →
  2. Notas fiscais → 3. Etiquetas e DANFE simplificada → 4. Baixa, no dia seguinte, pelo líder de expedição.
  Notas fiscais: só admin; o resto, a expedição toda (o Gabriel baixa o picking e o PDF de etiquetas na Expedição,
  sem acesso ao Planejamento). A aba escolhida fica guardada no aparelho.
- Etiquetas e DANFE (Expedição › 3, `src/pages/ExpedicaoEtiquetas.jsx` + `src/lib/documentosEnvio.js`): um PDF por dia,
  na ordem do picking, para a térmica 10 × 15: UMA etiqueta por pedido, com a etiqueta de transporte em cima
  (`GET /logisticas/etiquetas`, a que a logística já gerou no Bling) e, se há nota autorizada, a DANFE simplificada
  embaixo, montada pelo sistema com o XML da nota (chave com Code 128, protocolo, emitente, destinatário; sem valor
  total, que deixou de ser obrigatório pela NT 2020.004): o Bling não entrega a DANFE simplificada pela API. A
  etiqueta não é reduzida: o sistema corta só as sobras em branco do modelo do Bling (Correios, Lalamove) e o
  rodapé com o logo do Melhor Envio (J&T, Jadlog); modelo desconhecido é reduzido para caber, com aviso na tela.
  O picking sai em A4 (aba 1). Pedido sem NF só sai por Lalamove ou Retirada: nas abas 2 e 3, pedido sem nota
  com outra transportadora aparece como problema. Só leitura
  (`acao:'documentos'`): não gera etiqueta nem contrata frete. Etiqueta dos Correios (contrato) e do Bling Envios
  (J&T, Jadlog) sai sozinha no Bling quando a NF é autorizada; a da Lalamove existe sem NF. Os PDFs do Bling ficam
  no S3 com link de 1 h e bloqueiam o navegador (CORS), por isso a função baixa e devolve em base64.
- Notas fiscais (Expedição › 2. Notas fiscais, só admin; `src/pages/ExpedicaoNotas.jsx`): para os pedidos do
  picking (ou números digitados) mostra a natureza que a regra pede e o motivo (`acao:'notas'`, só leitura),
  gera as notas como rascunho pendente no Bling (`rascunhoNF`) e transmite à Sefaz (`transmitirNF`) só as
  que conferem, depois do clique e da confirmação. A conferência é refeita no servidor antes de transmitir.
  Natureza não vem no pedido: o Bling escolhe ao gerar a nota (consumidor final para PF, venda de mercadoria
  para PJ, a do cadastro para clientes com ST); o sistema compara com a regra:
  - Shopify: pago qualquer valor → venda ao consumidor final; total R$ 0 com cupom `voucher*` → bonificação
    (R$ 0 sem voucher ou pedido não achado na Shopify: manual).
  - Não levam NF: lojas Ativação (Envio e Degustação), Marketing, Bonificação/Outros e Laricas Experience.
    Se alguém emitir uma à mão, a natureza ainda é conferida (bonificação; Experience: entrega de presente).
  - Nas outras lojas, pedido que não leva NF (ex.: separação para evento) é marcado "Sem NF" com o motivo; a
    marca fica no picking do dia (`expedicao_pickings.pedidos[].semNF`) e é mantida se o picking for gerado de novo.
  - Clube/Rits/Mercado Livre → consumidor final; Reenvio → reposição de mercadoria. Bonificação é sempre
    "BONIFICAÇÃO" (não usar "Saída em bonificação").
  - Revenda e Venda Direta → qualquer natureza de venda do cadastro do cliente (ST já configurado lá).
    Consignação é sempre manual, pelo Bling. Loja sem regra: manual.
  - Gerar a nota pela API deixa o pedido Atendido: com a nota pendente, o sistema devolve para Em aberto
    (quem deixa Atendido é a baixa). O Bling numera a nota já no rascunho.
  - Escopos do app do Bling: Notas Fiscais, Emissão de NF-e, Pedidos de Venda, Gerenciar Pedidos de Venda e
    Gerenciar situações dos Pedidos de Venda; para o Financeiro, só leitura de Caixas e Bancos, Contas a Pagar,
    Contas a Receber, Categorias Receitas e Despesas e Clientes e Fornecedores (mudar escopo derruba o acesso:
    reconectar em Expedição › Conectar o Bling).
- Lalamove (Baixa, `src/pages/ExpedicaoLalamove.jsx` + `api/lalamove.mjs`): cada pacote lido que está numa rota Lalamove
  do planejamento (Logística › rotas, `logistica_historico.rotas[].stops`, `stop.id` = nº do pedido no Bling) mostra
  a rota e quantos pacotes dela foram lidos. "Chamar Lalamove" faz a cotação em moto (paradas na ordem da rota,
  coleta na R. Pedroso 258) e mostra o preço; o Gabriel confirma e a corrida é criada (API v3, assinatura HMAC,
  `Market: BR`). Entrega na casa do cliente: só vale a localização EXATA do número (Google, se houver
  `GOOGLE_MAPS_API_KEY` no Vercel; senão OpenStreetMap/Nominatim, 1 consulta/s). Parada sem número, sem telefone
  ou não localizada bloqueia a cotação (corrige no Bling e gera a rota de novo, ou deixa para amanhã). Endereço
  comercial (sala, cj, conjunto, andar, loja, escritório; destinatário com CNPJ/LTDA) pergunta se deixa para amanhã:
  o pedido sai da leitura e entra em `expedicao_adiamentos` (`expedicao_adiamentos.sql`, RLS sem policy), que aparece
  no topo da Expedição na manhã seguinte até a baixa (ou "Resolvido").
  Trava de custo do Google (`geocode_trava.sql`): no máximo 250 consultas por dia e 8.000 por mês (o grátis é
  10.000/mês); passou, o Google fica de fora e vale só o OpenStreetMap. Endereço localizado fica em `geocode_cache` e
  não consulta de novo. Sem o SQL aplicado, o Google não é usado. Chave: Google Cloud › projeto "My First Project",
  "Maps Platform API Key" restrita à Geocoding API. Diagnóstico: `POST /api/lalamove {acao:'testeGoogle'}`. A corrida fica em `lalamove_corridas` (`lalamove_corridas.sql`, RLS sem policy) e o link de acompanhamento
  vai como rastreio da Shopify na baixa. Não chama duas vezes os mesmos pedidos (3 dias). Variáveis no Vercel:
  `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET` (Partner Portal, mercado Brazil) e `LALAMOVE_AMBIENTE` (`sandbox` ou
  `producao`; em produção a corrida é cobrada).
- Acesso ao Bling: app privado "Laricas Expedição" (Central de Extensões › Área do integrador), OAuth com
  `enable-jwt: 1`. Os tokens ficam em `integracao_tokens` (RLS sem política: só a função lê,
  com a service_role). O refresh token vale 30 dias e se renova a cada uso. A conexão (token, limite de
  3 requisições/s, espera quando o Bling devolve 429) fica em `api/_bling.mjs`, usada pela Expedição e pelo
  Financeiro.
- Financeiro › Importar e classificar › **Atualizar do Bling** (`api/financeiro.mjs`, só admin, só leitura no
  Bling): lê o caixa (Caixas e Bancos), as contas a pagar e as a receber do mês atual e dos 2 anteriores, mostra
  "no sistema × no Bling" por mês e só grava depois do clique, com as regras da importação por arquivo (substitui
  o mês, respeita o cadeado). A importação por arquivo continua como reserva. A busca vai em partes de ~40 s
  (o navegador continua com um cursor; quando o Bling pede pausa, espera e continua).
  - Caixa: a lista do Bling não traz categoria, mas filtra por ela: lê a lista do período e a de cada categoria;
    lançamento sem categoria tem o detalhe lido. Histórico = observações do lançamento (a "descrição" da API repete a categoria).
    O id do lançamento na API é o mesmo da coluna Id do extrato exportado.
  - Contas: a lista não filtra por competência nem traz competência, categoria e histórico. Pega as contas com
    vencimento de 1 mês antes a 3 meses depois do período e as emitidas de 1 mês antes até o fim do período
    (pega as parcelas de vencimento distante de uma venda parcelada, todas emitidas no mesmo dia) e guarda o detalhe em `bling_contas` (`bling_contas.sql`, RLS sem política: só a função). O detalhe é lido de
    novo quando o valor ou o vencimento mudam, ou com "Ler de novo o detalhe de todas as contas" (categoria ou
    competência alteradas no Bling). A situação vem sempre da lista. Devolvidas e canceladas ficam fora;
    "Devolvido parcial" = Parcial, "Confirmado" = Em aberto. Data de baixa fica em branco (como no arquivo).
- Variáveis no Vercel: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
  e as da Shopify (o app precisa de `write_orders` e `write_merchant_managed_fulfillment_orders`).

## Hoje (tarefas do dia)

Primeira área do menu e tela inicial depois do login (`src/pages/Hoje.jsx`, regras em `src/lib/tarefas.js`).
Mostra as tarefas das áreas que o usuário acessa (admin: todas). A ✓ vem sozinha quando o sistema acha o
registro da tarefa; senão, qualquer um marca à mão (`tarefas_marcadas`, `tarefas.sql`; desmarcar apaga). Só
contam os dias trabalhados (mesma regra da conferência: seg a sex, menos feriados e dias sem produção).

| Área | Tarefa | Marca sozinha quando |
|---|---|---|
| Produção | Registrar a produção do dia | há produção lançada com a data de hoje |
| Produção | Fechar o planejamento do próximo dia | existe o picking do próximo dia trabalhado |
| Logística | Baixar o picking do dia | o picking de hoje foi baixado |
| Logística | Montar as rotas | roteiro gerado hoje |
| Logística | Contagem do Delivery BV (seg a sex) | contagem com a data de hoje |
| Logística | Baixa dos pedidos enviados | houve baixa hoje ("X de Y" do picking anterior é informação: Revenda e Venda Direta não passam pela baixa) |
| Estoque | Contagem semanal de MP e de embalagens (⭐) | todos os ⭐ contados desde a segunda; aparece no último dia trabalhado da semana e, se ficar pendente, como atrasada na semana seguinte |
| Estoque | Contagem completa do mês | todos os itens ativos contados nos últimos 3 dias do mês; atrasada até o dia 5 |
| Financeiro | Fechar a DRE do mês anterior | competência e caixa com cadeado (a partir do dia 5) |

**Admin › Acompanhamento de tarefas** (`src/pages/AcompanhamentoTarefas.jsx`, primeira aba do Admin): as mesmas
tarefas de todas as áreas nos últimos 5–15 dias trabalhados, numa grade tarefa × dia — feita (sozinha ou à mão),
por quem e a que horas, pendente hoje ou não feita — e um resumo por área (hoje e % do período). Quem fez vem
do próprio registro: `registrado_por` da produção e do Delivery, `gerado_por`/`baixado_por` do picking,
`criado_por` da rota, `operador` da baixa, `responsavel` da conferência, `fechado_por` da DRE. Muitas contas
são compartilhadas ("Expedição / Logística", "Administrador"): o nome é o do usuário logado, não da pessoa.

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
- **Consumo** (aba própria): de uma contagem para a seguinte, por produto, *saiu da geladeira* = geladeira
  anterior + reposto da armazenagem (quanto ela diminuiu) − geladeira do dia, comparado com a previsão de
  delivery dos dias entre as duas contagens. Negativo = produção nova entrou direto ou erro de contagem.
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

**Real** — `estoque inicial + compras − estoque final`, em R$ (`src/lib/cmv.js`).
Não depende de ficha nenhuma. Vale para matéria-prima e, **a partir de dez/2026**
(`INICIO_EMB_REAL`, contagem completa de abertura em 30/11/2026), para embalagem e
rótulo: contagens em `inventarios`, compras em `recebimento_itens`, saídas em
`producao_diaria` (rótulo, embalagens vinculadas e ajustes do Log). Antes disso — e
para embalagem nunca contada, sem estoque inicial e final — produção × ficha +
perda configurável (`perda_embalagem_pct`, padrão 2%), para não sumir do CMV.

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
`mp_compras.entrou_no_saldo` (embalagem: `recebimento_itens.entrou_no_saldo`).
Vale o momento do lançamento: compra lançada antes da contagem já foi absorvida
por ela. Mesma regra para os dois tipos (`src/lib/contagem.jsx`).

**Embalagem** não guarda saldo. É recalculado por `calcularEstoqueCronologico()`
a partir do último inventário, somando os recebimentos lançados depois dele e
subtraindo `producao_diaria`. O campo `estoque_atual` de embalagens existe mas não
é a fonte de verdade. O saldo muda **só por compra e contagem** (o ajuste manual do
Admin foi retirado). Editar ou excluir compra de embalagem de mês fechado no CMV é
bloqueado, como na MP.

**Rotina de contagem** (as duas Conferências): toda semana, só os itens principais
(`contagem_semanal`, ⭐ na tela; sugestão inicial = curva A, ~80% do valor consumido
em 90 dias); no **último dia do mês, todos** — é o estoque final do CMV (contagem até
3 dias antes ainda vale; nos últimos 3 dias do mês a tela já abre em "todos"). A
conferência de embalagem guarda o custo da data, como a de MP (`estoque_embalagem.sql`).

### O que debita estoque

Só o **registro de produção** (`Producao.jsx`), nunca o planejamento:

- o rótulo do produto — 1 por unidade
- as embalagens vinculadas — × a quantidade do vínculo (linhas "… (auto-embalagem)"
  em `producao_diaria`, somadas por lote)
- a matéria-prima — pela ficha técnica
- o desperdício da fase 6, quando vinculado a uma matéria-prima

Editar, excluir, adicionar, mudar a data ou desfazer produção pelo **Log** corrige
tudo isso junto (`src/lib/producao.js`): devolve a MP de `mp_consumos` e grava um
ajuste das embalagens vinculadas com a diferença (negativo devolve).

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

**Financeiro (DRE)** — `dre_contas_competencia`, `dre_receber_competencia`, `dre_caixa_lancamentos`,
`dre_caixa` (balancete), `dre_mes` (cadeado), `bling_contas` (cache da API); DRE Laricas (`dre_laricas.sql`):
`dre_plano`, `dre_regras`, `dre_classificacao`, `dre_receitas`, `dre_manuais`, `dre_saldos`. `dre_mapa` era da
classificação antiga e não é mais usada.

Tabelas `fin_*` pertencem ao módulo financeiro antigo, desativado.

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
- Estoque de produto acabado não é controlado (a contagem do Delivery BV é só
  acompanhamento), então o CMV é custo de produção, não custo de vendas
