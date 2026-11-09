// DRE gerencial (Financeiro › DRE) — competência e caixa.
//
// Fontes:
//   Competência  despesas: export "Contas a pagar por competência" do Bling (dre_contas_competencia)
//                receita:  digitada na tela (dre_receita_competencia) — o Bling não tem essa visão
//                CMV:      fechamento do sistema (fechamento_cmv: EI + compras − EF) quando o mês
//                          está fechado; senão, as compras de MP/embalagem lançadas no Bling
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
  ded_descontos:  { nome: 'Descontos e devoluções',               sinal: -1 },
  cmv:            { nome: 'CMV (matéria-prima + embalagem do produto)', sinal: -1 },
  custo_producao: { nome: 'Outros custos de produção',            sinal: -1 },
  dv_comercial:   { nome: 'Comercial (frete, embalagem de envio, taxas, comissão)', sinal: -1 },
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
  { tipo: 'grupo', id: 'custo',      nome: '(−) Custo dos produtos', linhas: ['cmv', 'custo_producao'] },
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

// ── Classificação padrão das categorias do Bling ─────────────────────────────
// Categorias ambíguas (mesmo nome em várias áreas) ficam de fora de propósito:
// a tela pede para classificar por fornecedor.
export const AMBIGUAS = ['Prestador de Serviço', 'Salario Pessoal', 'Outros', 'Sistema', 'Delivery', 'Pessoal', '-', '']

export const MAPA_PADRAO = {
  competencia: {
    'CMV - Matéria Prima': 'cmv', 'CMV - Embalagens Produto': 'cmv',
    'CMV - Embalagens Envio': 'dv_comercial', 'CMV - Aux. Operação': 'custo_producao',
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
export function montarDRE({ visao, meses, contas = [], caixa = [], receitas = [], cmvSistema = {}, mapaDB = [] }) {
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
