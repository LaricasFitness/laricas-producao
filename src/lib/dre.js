// DRE gerencial (Financeiro › DRE) — competência e caixa.
//
// Fontes:
//   Competência  despesas: export "Contas a pagar por competência" do Bling (dre_contas_competencia)
//                receita:  digitada na tela (dre_receita_competencia) — o Bling não tem essa visão
//                CMV:      fechamento do sistema (fechamento_cmv: EI + compras − EF) quando o mês
//                          está fechado; senão, as compras de MP/embalagem lançadas no Bling
//                plataformas: faturamento do mês de cada loja no iFood, 99 Food, Keeta, Anota.AI
//                          (dre_canal_competencia, lido do print do portal ou digitado)
//   Caixa        Balancete do Bling, total do mês por categoria principal (dre_caixa)
//
// Cada categoria do Bling vira uma linha da DRE pelo MAPA_PADRAO abaixo ou pela
// classificação salva na tela (dre_mapa), que tem prioridade. Categorias com o mesmo
// nome em áreas diferentes ("Prestador de Serviço", "Outros"…) são classificadas
// por fornecedor.

// ── Linhas ────────────────────────────────────────────────────────────────────
// sinal: +1 soma no resultado, −1 subtrai
export const LINHAS = {
  rec_delivery:   { nome: 'Delivery (iFood, 99, Keeta, Anota.Ai)', sinal: +1 },
  rec_site:       { nome: 'Venda Site',                           sinal: +1 },
  rec_revenda:    { nome: 'Revenda (B2B)',                        sinal: +1 },
  rec_direta:     { nome: 'Venda Direta',                         sinal: +1 },
  rec_balcao:     { nome: 'Venda Balcão',                         sinal: +1 },
  rec_ativacao:   { nome: 'Venda Ativação',                       sinal: +1 },
  rec_outras:     { nome: 'Outras receitas',                      sinal: +1 },
  rec_nao_class:  { nome: 'Receita sem classificação',            sinal: +1, alerta: true },
  ded_impostos:   { nome: 'Impostos sobre vendas (DAS)',          sinal: -1 },
  ded_descontos:  { nome: 'Descontos, promoções e devoluções',    sinal: -1 },
  cmv:            { nome: 'CMV (matéria-prima + embalagem do produto)', sinal: -1 },
  cmv_envio:      { nome: 'Embalagem de envio',                   sinal: -1 },
  custo_producao: { nome: 'Outros custos de produção',            sinal: -1 },
  dv_comercial:   { nome: 'Comercial (frete, taxas, comissão)', sinal: -1 },
  dv_marketing:   { nome: 'Marketing (tráfego, ativação, influenciadores)',        sinal: -1 },
  dv_operacional: { nome: 'Operacional (limpeza, manutenção, consumíveis)',        sinal: -1 },
  dv_administrativo: { nome: 'Administrativo',                    sinal: -1 },
  nao_class:      { nome: 'Despesa sem classificação',            sinal: -1, alerta: true },
  df_operacional: { nome: 'Operacional (aluguéis, luz, salários, sistemas)', sinal: -1 },
  df_administrativo: { nome: 'Administrativo (pró-labore, contador, sistemas)', sinal: -1 },
  df_comercial:   { nome: 'Comercial',                            sinal: -1 },
  df_marketing:   { nome: 'Marketing',                            sinal: -1 },
  fin_receitas:   { nome: 'Receitas financeiras (rendimentos, juros)', sinal: +1 },
  fin_despesas:   { nome: 'Despesas financeiras (tarifas, juros, acréscimos)', sinal: -1 },
  investimento:   { nome: 'Investimentos (equipamento, mobília, estrutura)', sinal: -1 },
  ignorar:        { nome: 'Não entra na DRE (transferências entre contas)', sinal: 0 },
}

// Linhas que a tela de classificação oferece
export const LINHAS_ESCOLHA = Object.keys(LINHAS).filter(k => !['rec_nao_class', 'nao_class'].includes(k))

export const RECEITAS = ['rec_delivery', 'rec_site', 'rec_revenda', 'rec_direta', 'rec_balcao', 'rec_ativacao', 'rec_outras']

// ── Desenho da DRE ────────────────────────────────────────────────────────────
// grupo: soma das linhas (com o sinal de cada uma); total: acumulado até ali
export const ESTRUTURA = [
  { tipo: 'grupo', id: 'receita',    nome: 'Receita bruta', linhas: [...RECEITAS, 'rec_nao_class'] },
  { tipo: 'grupo', id: 'deducao',    nome: '(−) Deduções da receita', linhas: ['ded_impostos', 'ded_descontos'] },
  { tipo: 'total', id: 'rec_liquida', nome: '= Receita líquida' },
  { tipo: 'grupo', id: 'custo',      nome: '(−) Custo dos produtos', linhas: ['cmv', 'cmv_envio', 'custo_producao'] },
  { tipo: 'total', id: 'lucro_bruto', nome: '= Lucro bruto' },
  { tipo: 'grupo', id: 'variavel',   nome: '(−) Despesas variáveis', linhas: ['dv_comercial', 'dv_marketing', 'dv_operacional', 'dv_administrativo', 'nao_class'] },
  { tipo: 'total', id: 'margem',     nome: '= Margem de contribuição' },
  { tipo: 'grupo', id: 'fixa',       nome: '(−) Despesas fixas', linhas: ['df_operacional', 'df_administrativo', 'df_comercial', 'df_marketing'] },
  { tipo: 'total', id: 'operacional', nome: '= Resultado operacional' },
  { tipo: 'grupo', id: 'financeiro', nome: '(±) Resultado financeiro', linhas: ['fin_receitas', 'fin_despesas'] },
  { tipo: 'total', id: 'liquido',    nome: '= Lucro líquido', destaque: true },
  { tipo: 'grupo', id: 'abaixo',     nome: '(−) Investimentos (abaixo da linha)', linhas: ['investimento'] },
  { tipo: 'total', id: 'pos_invest', nome: '= Resultado depois dos investimentos' },
]

// ── Plataformas de delivery (faturamento por canal e unidade) ────────────────
// Unidades da DRE gerencial: BV Bela Vista, ZN Santana, BK Brooklin, PR Maringá. A primeira da lista é a sugestão.
export const PLATAFORMAS = [
  { canal: 'iFood',    unidades: ['BV', 'ZN', 'BK', 'PR'] },
  { canal: '99 Food',  unidades: ['BV', 'BK'] },
  { canal: 'Keeta',    unidades: [''] },
  { canal: 'Anota.AI', unidades: ['BV'] },
]
// Nome da loja no print → sigla da unidade (o que já foi lançado antes também ensina)
// BV Bela Vista · ZN Santana · BK Brooklin · PR Maringá
const NOMES_UNIDADE = { BV: /bela[\s-]*vista/i, ZN: /santana/i, BK: /brooklin/i, PR: /maring/i }
export function siglaUnidade(texto, anteriores = []) {
  const t = String(texto || '').trim()
  if (!t) return ''
  // compara o começo do nome: o print corta o fim ("Pães de...")
  const base = x => x.toLowerCase().replace(/\.{3}|…/g, '').split(' - ').slice(0, 2).join(' - ').trim()
  const ja = anteriores.find(r => r.unidade_print && base(r.unidade_print) === base(t))
  if (ja) return ja.unidade
  return Object.keys(NOMES_UNIDADE).find(k => NOMES_UNIDADE[k].test(t)) || ''
}
export const rotuloCanal = r => [r.canal, r.unidade].filter(Boolean).join(' ')
// Comissão e taxas que vão para a DRE: taxas + serviços − ajustes a favor da loja
export const custoCanal = r => (Number(r.taxas) || 0) + (Number(r.servicos) || 0) - (Number(r.ajustes) || 0)
// Anúncios pagos na plataforma (no portal vêm dentro de Serviços) vão para Marketing
export const marketingCanal = r => Number(r.marketing) || 0
// O que o portal diz que a loja recebeu: vendas − promoções − taxas − serviços − anúncios + ajustes
export const liquidoCanal = r => (Number(r.vendas) || 0) - (Number(r.promocoes) || 0) - custoCanal(r) - marketingCanal(r)
// Linhas da DRE que recebem o faturamento das plataformas
export const LINHAS_CANAL = { rec_delivery: r => Number(r.vendas) || 0, ded_descontos: r => Number(r.promocoes) || 0, dv_comercial: custoCanal, dv_marketing: marketingCanal }

// ── Classificação padrão das categorias do Bling ─────────────────────────────
// Categorias ambíguas (mesmo nome em várias áreas) ficam de fora de propósito:
// a tela pede para classificar por fornecedor.
export const AMBIGUAS = ['Prestador de Serviço', 'Salario Pessoal', 'Outros', 'Sistema', 'Delivery', 'Pessoal', '-', '']

export const MAPA_PADRAO = {
  competencia: {
    'CMV - Matéria Prima': 'cmv', 'CMV - Embalagens Produto': 'cmv',
    'CMV - Embalagens Envio': 'cmv_envio', 'CMV - Aux. Operação': 'custo_producao',
    'Impostos sobre vendas': 'ded_impostos', 'Descontos concedidos': 'ded_descontos',
    // DV Comercial
    'Frete': 'dv_comercial', 'Fretes e seguros': 'dv_comercial', 'Testes': 'dv_comercial',
    'Comissão Vendas': 'dv_comercial', 'Bonificação Time Comercial': 'dv_comercial',
    'Taxa de cartão': 'dv_comercial', 'Desperdício (Vencido/Reenvio)': 'dv_comercial',
    'Novas Revendas': 'dv_comercial', 'Taxas do marketplace': 'dv_comercial', 'Taxas pagas': 'dv_comercial',
    // DV Marketing
    'Ativação': 'dv_marketing', 'Ativação - Degustação': 'dv_marketing', 'Digital': 'dv_marketing',
    'Tráfego Pago': 'dv_marketing', 'Influenciadores': 'dv_marketing', 'Outros Digital': 'dv_marketing',
    'Produtos': 'dv_marketing', 'Orgânico': 'dv_marketing',
    // DV Operacional
    'Manutenção/Compra Equipamento': 'dv_operacional', 'Outros OP': 'dv_operacional', 'Outros ADM': 'dv_operacional',
    'Limpeza e Higiêne': 'dv_operacional', 'Equipamentos sem valor': 'dv_operacional',
    'Consultorias/Prestadores': 'dv_operacional', 'Manutenção/Obra': 'dv_operacional',
    'Manutenção da Produção': 'dv_operacional', 'Manutenção de Equipamento': 'dv_operacional',
    'Bonificação Operacional': 'dv_operacional', 'Bonificação Produtos': 'dv_operacional',
    'Uniforme': 'dv_operacional', 'Consumiveis e Descartáveis': 'dv_operacional', 'Diária Evento': 'dv_operacional',
    // DV Administrativo
    'Equipamentos': 'dv_administrativo', 'Manutenção': 'dv_administrativo', 'Insumos': 'dv_administrativo', 'Obra': 'dv_administrativo',
    // DF Operacional (estrutura e pessoal da operação)
    'Infraestrutura': 'df_operacional', 'Aluguel Delivery': 'df_operacional', 'Aluguel Produção': 'df_operacional',
    'Aluguel': 'df_operacional', 'Luz': 'df_operacional', 'Energia elétrica': 'df_operacional', 'Sistemas': 'df_operacional',
    'Salarios pessoal': 'df_operacional', 'Salário': 'df_operacional', 'Salários': 'df_operacional',
    'Adiantamento Salarial': 'df_operacional', 'Diária': 'df_operacional', 'Transporte': 'df_operacional',
    'Vale transporte': 'df_operacional', 'Alimentação': 'df_operacional', 'Vale alimentação': 'df_operacional',
    'INSS': 'df_operacional', 'FGTS': 'df_operacional', '13° e Férias': 'df_operacional',
    // DF Administrativo
    'Pró-labore': 'df_administrativo', 'Serviços contábeis': 'df_administrativo', 'Taxas': 'df_administrativo',
    // Financeiro
    'Tarifa bancária': 'fin_despesas', 'Acréscimos pagos': 'fin_despesas', 'Juros pagos': 'fin_despesas',
    // Abaixo da linha / fora
    'Equipamento': 'investimento', 'Mobília': 'investimento', 'Estrutural': 'investimento',
    'Transferências': 'ignorar', 'Transferências de saída': 'ignorar',
  },
  caixa_despesa: {
    'CMV': 'cmv',
    'DV Comercial': 'dv_comercial', 'DV Marketing': 'dv_marketing',
    'DV Operacional': 'dv_operacional', 'DV Administrativo': 'dv_administrativo',
    'DF Operacional': 'df_operacional', 'DF Administrativo': 'df_administrativo',
    'DF Comercial': 'df_comercial', 'DF Marketing': 'df_marketing',
    'Despesas administrativas': 'df_administrativo', 'Despesas com pessoal': 'df_operacional',
    'Despesas comerciais': 'dv_comercial', 'Despesas com Marketing': 'df_marketing',
    'Impostos sobre vendas': 'ded_impostos',
    'Despesas adicionais em operações financeiras': 'fin_despesas', 'Tarifa bancária': 'fin_despesas',
    'Investimento': 'investimento', 'Transferências': 'ignorar',
  },
  caixa_receita: {
    'Delivery': 'rec_delivery', 'Venda Site': 'rec_site', 'Revenda': 'rec_revenda',
    'Venda Direta': 'rec_direta', 'Venda Balcão': 'rec_balcao', 'Venda Ativação': 'rec_ativacao',
    'Receitas adicionais em operações financeiras': 'fin_receitas',
    'Rendimento de aplicação financeira': 'fin_receitas',
    'Venda de ativo': 'rec_outras', 'Outras Receitas': 'rec_outras',
    'Transferências recebidas': 'ignorar', 'Transferências': 'ignorar',
  },
}

// Linha de uma categoria. mapaDB: linhas de dre_mapa. Devolve null se precisar classificar.
export function resolverLinha(origem, categoria, nome, mapaDB) {
  const cat = (categoria || '').trim(), n = (nome || '').trim()
  const achar = nm => mapaDB.find(m => m.origem === origem && m.categoria === cat && (m.nome || '') === nm)
  const porNome = n && achar(n)
  if (porNome) return porNome.linha
  const porCat = achar('')
  if (porCat) return porCat.linha
  if (origem === 'competencia' && AMBIGUAS.includes(cat)) return null
  return MAPA_PADRAO[origem]?.[cat] || null
}

// ── Leitura dos CSVs do Bling (";" e aspas) ──────────────────────────────────
export function lerCSV(texto) {
  const t = String(texto || '').replace(/^﻿/, '')
  const linhas = []
  let row = [], cur = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else if (c === '"') q = true
    else if (c === ';') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); linhas.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); linhas.push(row) }
  return linhas
}

export const numBR = s => {
  const v = parseFloat(String(s ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}
const dataBR = s => { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

// "Contas a pagar por competência" → [{competencia, vencimento_mes, nome, categoria, observacoes, valor, situacao}]
export function lerContasCompetencia(texto) {
  const linhas = lerCSV(texto)
  const cab = (linhas.shift() || []).map(h => h.trim().toLowerCase())
  const col = nome => cab.findIndex(h => h.startsWith(nome))
  const ix = {
    venc: col('data de vencimento'), comp: col('competência'), nome: col('nome'),
    baixa: cab.findIndex(h => /pagamento|baixa|liquida|quita/.test(h)),
    cat: col('descrição'), obs: col('observações'), valor: col('valor'), sit: col('situação'),
  }
  if (ix.comp < 0 || ix.valor < 0 || ix.cat < 0) {
    throw new Error('Não reconheci o arquivo: esperava as colunas Competência, Descrição (categoria) e Valor do relatório "Contas a pagar por competência".')
  }
  const contas = []
  for (const r of linhas) {
    const competencia = dataBR(r[ix.comp])
    if (!competencia) continue // linhas de total
    contas.push({
      competencia,
      vencimento_mes: ix.venc >= 0 ? r[ix.venc] || null : null,
      nome: ix.nome >= 0 ? (r[ix.nome] || '').trim() : '',
      categoria: (r[ix.cat] || '').trim(),
      observacoes: ix.obs >= 0 ? (r[ix.obs] || '').trim() : '',
      valor: numBR(r[ix.valor]),
      situacao: ix.sit >= 0 ? (r[ix.sit] || '').trim() : '',
      vencimento: ix.venc >= 0 ? dataBR(r[ix.venc]) : null,
      data_baixa: ix.baixa >= 0 ? dataBR(r[ix.baixa]) : null,
    })
  }
  return contas
}

// "Balancete" do mês → { mes, linhas: [{tipo, categoria, valor}], totais }
export function lerBalancete(texto) {
  const linhas = lerCSV(texto)
  const cab = linhas.shift() || []
  const datas = cab.join(' ').match(/\d{2}\/\d{2}\/\d{4}/g) || []
  if (!datas.length) throw new Error('Não reconheci o arquivo: o cabeçalho do Balancete traz as datas do período.')
  const mesDe = d => `${d.slice(6, 10)}-${d.slice(3, 5)}`
  const mes = mesDe(datas[0])
  if (mesDe(datas[datas.length - 1]) !== mes) {
    throw new Error(`O balancete cobre mais de um mês (${datas[0]} a ${datas[datas.length - 1]}). Exporte no Bling a opção "Do mês", um mês por vez.`)
  }
  const iTotal = cab.length - 1
  const SECOES = { 'receitas': 'receita', 'despesas': 'despesa', 'transferências de entrada': 'transferencia', 'transferências de saída': 'transferencia', 'resultado': null }
  let tipo = null
  const out = [], totais = {}
  for (const r of linhas) {
    const nome = (r[0] || '').trim()
    if (!nome) continue
    const vazio = r.slice(1).every(c => !String(c || '').trim())
    if (vazio && nome.toLowerCase() in SECOES) { tipo = SECOES[nome.toLowerCase()]; continue }
    if (!tipo) { totais[nome] = numBR(r[iTotal]); continue } // saldo inicial / totais / resultado
    out.push({ tipo, categoria: nome, valor: numBR(r[iTotal]) })
  }
  return { mes, linhas: out, totais }
}

// ── Montagem ──────────────────────────────────────────────────────────────────
// Devolve { porMes: { 'AAAA-MM': { linha: valor } }, extras: { mes: { cmvFonte, cmvCompras } }, pendentes }
// valores em módulo (positivos); o sinal vem de LINHAS
export function montarDRE({ visao, meses, contas = [], caixa = [], receitas = [], canais = [], cmvSistema = {}, mapaDB = [] }) {
  const porMes = {}, extras = {}, pendentes = new Map()
  for (const m of meses) { porMes[m] = {}; extras[m] = {} }
  const somar = (m, linha, v) => { if (porMes[m]) porMes[m][linha] = (porMes[m][linha] || 0) + v }
  const pendente = (origem, categoria, nome, valor) => {
    const k = `${origem}|${categoria}|${nome || ''}`
    const p = pendentes.get(k) || { origem, categoria, nome: nome || '', qtd: 0, valor: 0 }
    p.qtd++; p.valor += valor; pendentes.set(k, p)
  }

  if (visao === 'competencia') {
    const compras = {}
    for (const c of contas) {
      const m = c.competencia.slice(0, 7)
      if (!porMes[m]) continue
      const valor = Number(c.valor) || 0
      const linha = resolverLinha('competencia', c.categoria, c.nome, mapaDB)
      if (!linha) { somar(m, 'nao_class', valor); pendente('competencia', c.categoria, c.nome, valor); continue }
      if (linha === 'ignorar') continue
      if (linha === 'cmv') { compras[m] = (compras[m] || 0) + valor; continue }
      somar(m, linha, valor)
    }
    for (const r of receitas) if (porMes[r.mes] && RECEITAS.includes(r.linha)) somar(r.mes, r.linha, Number(r.valor) || 0)
    // Plataformas: cada loja vira uma sublinha (extras.sub[linha][rótulo]) dentro da linha da DRE
    for (const r of canais) {
      if (!porMes[r.mes]) continue
      const sub = extras[r.mes].sub || (extras[r.mes].sub = {})
      for (const [linha, valorDe] of Object.entries(LINHAS_CANAL)) {
        const v = valorDe(r)
        if (Math.abs(v) < 0.005) continue
        somar(r.mes, linha, v)
        sub[linha] = sub[linha] || {}
        sub[linha][rotuloCanal(r)] = (sub[linha][rotuloCanal(r)] || 0) + v
      }
    }
    for (const m of meses) {
      const sis = cmvSistema[m]
      extras[m].cmvCompras = compras[m] || 0
      extras[m].cmvFonte = sis != null ? 'sistema' : 'compras'
      somar(m, 'cmv', sis != null ? sis : (compras[m] || 0))
      extras[m].temReceita = RECEITAS.some(l => porMes[m][l])
    }
  } else {
    for (const c of caixa) {
      const m = c.mes
      if (!porMes[m] || c.tipo === 'transferencia') continue
      const valor = Number(c.valor) || 0
      const origem = c.tipo === 'receita' ? 'caixa_receita' : 'caixa_despesa'
      const linha = resolverLinha(origem, c.categoria, '', mapaDB)
      if (!linha) {
        somar(m, c.tipo === 'receita' ? 'rec_nao_class' : 'nao_class', valor)
        pendente(origem, c.categoria, '', valor); continue
      }
      if (linha !== 'ignorar') somar(m, linha, valor)
      extras[m].temCaixa = true
    }
  }
  return { porMes, extras, pendentes: [...pendentes.values()].sort((a, b) => b.valor - a.valor) }
}

// Valores da estrutura para um mês: { grupoId: valor com sinal, totalId: acumulado }
export function calcularEstrutura(valores) {
  const out = {}
  let acumulado = 0
  for (const e of ESTRUTURA) {
    if (e.tipo === 'grupo') {
      const v = e.linhas.reduce((s, l) => s + (LINHAS[l].sinal || 0) * (valores[l] || 0), 0)
      out[e.id] = v; acumulado += v
    } else out[e.id] = acumulado
  }
  return out
}

// ── Conferência do mês ────────────────────────────────────────────────────────
// Testes que mostram se as datas e os lançamentos do mês estão certos.
// status: ok | aviso | erro | info
const mesAnterior = m => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mesNum = m => +m.slice(0, 4) * 12 + +m.slice(5, 7)
// Mês de vencimento da conta: data completa ou "MM/AAAA" do relatório
export const mesVencimento = c => c.vencimento ? c.vencimento.slice(0, 7)
  : (/^\d{2}\/\d{4}$/.test(c.vencimento_mes || '') ? `${c.vencimento_mes.slice(3)}-${c.vencimento_mes.slice(0, 2)}` : null)
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const SEM_BAIXA = ['Atrasada', 'Parcial', 'Vencendo hoje'] // 'Em aberto' com vencimento passado o Bling já mostra como Atrasada

export function conferir({ visao, mes, dados, dre, mesInfo }) {
  const out = []
  const doMes = dados.contas.filter(c => c.competencia.startsWith(mes))
  const linhaDe = c => resolverLinha('competencia', c.categoria, c.nome, dados.mapaDB)

  if (visao === 'competencia') {
    const ex = dre.extras[mes] || {}
    const receita = RECEITAS.reduce((s, l) => s + (dre.porMes[mes]?.[l] || 0), 0)
    const canaisMes = (dados.canais || []).filter(r => r.mes === mes)
    const deCanais = canaisMes.reduce((s, r) => s + (Number(r.vendas) || 0), 0)
    out.push(receita > 0
      ? { status: 'ok', titulo: `Receita do mês: ${brl(receita)}`,
          detalhe: deCanais ? `Plataformas ${brl(deCanais)} + digitada ${brl(receita - deCanais)}.` : undefined }
      : { status: 'erro', titulo: 'Receita do mês não lançada', detalhe: 'Lance em Importar e classificar › Faturamento das plataformas e Receita por competência.' })

    // Plataformas: loja lançada no mês anterior e não neste; total lido do print que não fecha
    const antCanais = (dados.canais || []).filter(r => r.mes === mesAnterior(mes))
    const faltam = antCanais.filter(a => !canaisMes.some(r => r.canal === a.canal && r.unidade === a.unidade)).map(rotuloCanal)
    const naoFecha = canaisMes.filter(r => r.total_faturamento != null && Math.abs(liquidoCanal(r) - Number(r.total_faturamento)) >= 0.05)
      .map(r => `${rotuloCanal(r)}: as linhas dão ${brl(liquidoCanal(r))}, o portal diz ${brl(r.total_faturamento)}`)
    if (canaisMes.length || antCanais.length) out.push(faltam.length || naoFecha.length
      ? { status: 'aviso', titulo: `Plataformas: ${faltam.length} loja(s) sem faturamento lançado${naoFecha.length ? `, ${naoFecha.length} com total diferente do portal` : ''}`,
          detalhe: faltam.length ? 'Lojas que tinham faturamento no mês anterior.' : undefined,
          itens: [...faltam.map(k => 'Falta: ' + k), ...naoFecha] }
      : { status: 'ok', titulo: `Plataformas: ${canaisMes.length} loja(s) lançada(s), totais batem com o portal` })

    const sem = doMes.filter(c => !linhaDe(c))
    out.push(sem.length
      ? { status: 'aviso', titulo: `${sem.length} conta(s) sem linha na DRE (${brl(sem.reduce((s, c) => s + Number(c.valor), 0))})`,
          itens: sem.map(c => `${c.categoria || '(sem categoria)'} · ${c.nome} · ${brl(c.valor)}`) }
      : { status: 'ok', titulo: 'Todas as contas do mês estão classificadas' })

    // Contas fixas: o que tinha no mês anterior e sumiu, ou apareceu mais vezes
    const ant = mesAnterior(mes)
    const fixas = m => {
      const mapa = new Map()
      for (const c of dados.contas.filter(c => c.competencia.startsWith(m))) {
        const l = linhaDe(c)
        if (!l || !(l.startsWith('df_') || l === 'ded_impostos')) continue
        const k = `${c.nome} · ${c.categoria}`
        mapa.set(k, (mapa.get(k) || 0) + 1)
      }
      return mapa
    }
    const fa = fixas(ant), fm = fixas(mes)
    if (!fa.size) out.push({ status: 'info', titulo: 'Contas fixas: sem mês anterior importado para comparar' })
    else {
      const faltam = [...fa.keys()].filter(k => !fm.has(k))
      const dobradas = [...fm.entries()].filter(([k, n]) => fa.has(k) && n > fa.get(k)).map(([k, n]) => `${k} (${n}× neste mês, ${fa.get(k)}× no anterior)`)
      out.push(faltam.length || dobradas.length
        ? { status: 'aviso', titulo: `Contas fixas diferentes do mês anterior: ${faltam.length} faltando, ${dobradas.length} a mais`,
            detalhe: 'Pode ser normal (contrato novo ou encerrado). Se não for, a competência de alguma conta está no mês errado.',
            itens: [...faltam.map(k => 'Faltando: ' + k), ...dobradas.map(k => 'A mais: ' + k)] }
        : { status: 'ok', titulo: 'Contas fixas iguais ao mês anterior' })
    }

    // Competência muito longe do vencimento
    const longe = doMes.filter(c => { const v = mesVencimento(c); if (!v) return false; const d = mesNum(v) - mesNum(mes); return d >= 3 || d <= -2 })
    out.push(longe.length
      ? { status: 'aviso', titulo: `${longe.length} conta(s) com vencimento muito distante da competência`,
          detalhe: 'Vencimento 3+ meses depois ou 2+ meses antes. Confira se a data de competência está certa.',
          itens: longe.map(c => `${c.nome} · ${c.categoria} · vence ${mesVencimento(c)} · ${brl(c.valor)}`) }
      : { status: 'ok', titulo: 'Competência perto do vencimento em todas as contas' })

    out.push(ex.cmvFonte === 'sistema'
      ? { status: 'info', titulo: `CMV do fechamento do sistema: ${brl(dre.porMes[mes]?.cmv)}`,
          detalhe: `Compras de MP e embalagem do produto lançadas no Bling: ${brl(ex.cmvCompras)}.` }
      : { status: 'aviso', titulo: 'CMV pelas compras do mês', detalhe: 'Mês sem fechamento de CMV no sistema.' })
  } else {
    const temCaixa = dados.caixa.some(c => c.mes === mes)
    out.push(temCaixa ? { status: 'ok', titulo: 'Balancete do mês importado' }
      : { status: 'erro', titulo: 'Balancete do mês não importado' })

    const semCls = dados.caixa.filter(c => c.mes === mes && c.tipo !== 'transferencia' &&
      !resolverLinha(c.tipo === 'receita' ? 'caixa_receita' : 'caixa_despesa', c.categoria, '', dados.mapaDB))
    out.push(semCls.length
      ? { status: 'aviso', titulo: `${semCls.length} categoria(s) sem linha na DRE`, itens: semCls.map(c => `${c.categoria} · ${brl(c.valor)}`) }
      : { status: 'ok', titulo: 'Todas as categorias do balancete estão classificadas' })

    // Contas vencidas até o fim do mês e ainda sem baixa no Bling
    const pend = dados.contas.filter(c => { const v = mesVencimento(c); return SEM_BAIXA.includes(c.situacao) && !!v && v <= mes })
    out.push(pend.length
      ? { status: 'aviso', titulo: `${pend.length} conta(s) vencida(s) sem baixa no Bling (${brl(pend.reduce((s, c) => s + Number(c.valor), 0))})`,
          detalhe: 'Se já foram pagas, falta dar baixa no Bling com a data do pagamento: elas não estão nas saídas do caixa.',
          itens: pend.map(c => `${c.situacao} · vence ${mesVencimento(c) || '?'} · ${c.nome} · ${brl(c.valor)}`) }
      : { status: 'ok', titulo: 'Nenhuma conta vencida sem baixa' })

    const sb = mesInfo?.saldo_final_bling, bancos = mesInfo?.saldo_bancos
    if (sb == null) out.push({ status: 'info', titulo: 'Saldo final do balancete não disponível', detalhe: 'Importe o balancete de novo para guardar o saldo final.' })
    else if (bancos == null) out.push({ status: 'aviso', titulo: `Saldo final no Bling: ${brl(sb)}`, detalhe: 'Digite abaixo a soma dos saldos dos bancos no último dia do mês para conferir.' })
    else {
      const dif = Number(bancos) - Number(sb)
      out.push(Math.abs(dif) < 1
        ? { status: 'ok', titulo: `Saldo dos bancos bate com o Bling (${brl(sb)})` }
        : { status: 'erro', titulo: `Saldo dos bancos difere do Bling em ${brl(dif)}`,
            detalhe: `Bancos ${brl(bancos)} × Bling ${brl(sb)}. Falta baixa, a data de alguma baixa está errada ou há lançamento duplicado.` })
    }
  }
  return out
}
