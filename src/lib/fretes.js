import { lerXlsx } from './lerXlsx'

// Fretes por competência (data do envio), a partir dos relatórios de cada transportadora:
//   Correios: "Extrato analítico de fatura" (.csv) — cada objeto com a data de postagem; créditos na data de fechamento
//   Lalamove: "Order Report" (.xlsx) — cada corrida com o valor final cobrado
//   Melhor Envio: "Relatório de envios" (.xlsx) — cada etiqueta com o preço (canceladas ficam de fora)
// Cada linha vira { origem, chave, data (AAAA-MM-DD), mes, valor (positivo = custo), descricao, documento }.
// A chave identifica o envio: importar de novo o mesmo arquivo (ou um período que se sobrepõe) não duplica.

export const ORIGENS_FRETE = { correios: 'Correios', lalamove: 'Lalamove', melhorenvio: 'Melhor Envio' }

const num = s => { const t = String(s ?? '').trim(); if (!t) return 0; return parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0 }
const r2 = v => Math.round(v * 100) / 100
const linha = (origem, chave, data, valor, descricao, documento) => ({ origem, chave: `${origem}:${chave}`, data, mes: data.slice(0, 7), valor: r2(valor), descricao, documento })
const dataBR = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }

function textoDe(buf) {
  const utf = new TextDecoder('utf-8').decode(buf)
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf
}

// Correios: blocos separados por linha em branco, cada um com seu cabeçalho
function lerCorreios(texto) {
  const ls = texto.split(/\r?\n/).map(l => l.split(';'))
  const iCab = ls.findIndex(l => l[0] === 'Nº DA FATURA' || /DA FATURA$/.test(l[0]))
  const fat = ls[iCab + 1] || [], cab = ls[iCab] || []
  const fatura = fat[cab.indexOf('Nº DA FATURA')] || fat[0], fechamento = fat[cab.findIndex(c => /FECHAMENTO/.test(c))] || ''
  const out = []
  const iObj = ls.findIndex(l => l[0] === 'CARTAO POSTAGEM')
  if (iObj >= 0) {
    const h = ls[iObj], c = n => h.indexOf(n)
    for (let i = iObj + 1; i < ls.length && ls[i].length > 3; i++) {
      const l = ls[i]
      const data = l[c('DATA POSTAGEM')], valor = num(l[c('VALOR LIQUIDO')])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue
      out.push(linha('correios', `${fatura}:${l[c('ETIQUETA')]}:${l[c('CODIGO SERVICO')]}:${l[c('DOCUMENTO')]}`, data, valor, `${l[c('SERVICO')]} ${l[c('ETIQUETA')]} → CEP ${l[c('CEP DESTINATARIO')]}`, `fatura ${fatura}`))
    }
  }
  // créditos, débitos e encargos da fatura: na data de fechamento
  for (const titulo of ['DESCRICAO CREDITO', 'DESCRICAO DEBITO', 'DESCRICAO ENCARGO', 'DESCRICAO REMANESCENTE']) {
    const i = ls.findIndex(l => l[0] === titulo)
    if (i < 0) continue
    for (let j = i + 1; j < ls.length && ls[j][0]; j++) {
      const desc = ls[j][0].replace(/\.{3,}$/, '').trim(), valor = num(ls[j][1])
      if (valor && /^\d{4}-\d{2}-\d{2}$/.test(fechamento)) out.push(linha('correios', `${fatura}:${desc}`, fechamento, valor, desc, `fatura ${fatura}`))
    }
  }
  const iTot = ls.findIndex(l => l[0] === 'Total da Fatura')
  const total = iTot >= 0 ? num(ls[iTot][2]) : null
  // vencimento da fatura: até ele, os envios dela estão a pagar (prova da competência)
  const venc = fat[cab.findIndex(c => /VENCIMENTO/.test(c))] || ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(venc)) for (const l of out) l.vencimento = venc
  return { origem: 'correios', documento: `fatura ${fatura}`, linhas: out, totalArquivo: total }
}

function lerLalamove(linhas) {
  const iCab = linhas.findIndex(l => l[0] === 'ORDER ID')
  const h = linhas[iCab], c = n => h.indexOf(n)
  const out = []
  for (const l of linhas.slice(iCab + 1)) {
    if (!l[0] || !/^\d+$/.test(String(l[0]))) continue
    const valor = -num(l[c('FINAL CHARGE')])
    const data = String(l[c('COMPLETED TIME')] || l[c('CANCELED TIME')] || l[c('CREATED TIME')] || '').slice(0, 10)
    if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(data)) continue
    out.push(linha('lalamove', l[0], data, valor, `${l[c('ORDER STATUS')]} · ${l[c('ORDER PATH')] || ''}`.slice(0, 160), 'Order Report'))
  }
  return { origem: 'lalamove', documento: 'Order Report', linhas: out, totalArquivo: null }
}

function lerMelhorEnvio(linhas) {
  const iCab = linhas.findIndex(l => l[0] === 'Código de envio')
  const h = linhas[iCab], c = n => h.indexOf(n)
  const out = []
  for (const l of linhas.slice(iCab + 1)) {
    if (!l[0] || /cancel/i.test(l[c('Status')] || '')) continue
    const data = dataBR(l[c('Data de criação')]), valor = num(l[c('Preço conferido')] || l[c('Preço')])
    if (!data || !valor) continue
    out.push(linha('melhorenvio', l[0], data, valor, `${l[c('Transportadora')]} ${l[c('Serviço')]} · ${l[c('Destinatário - Cidade')] || ''} · ${l[c('Status')]}`, 'Relatório de envios'))
  }
  return { origem: 'melhorenvio', documento: 'Relatório de envios', linhas: out, totalArquivo: null }
}

// Lê um arquivo (File) e reconhece o formato
export async function lerArquivoFrete(arquivo) {
  const buf = new Uint8Array(await arquivo.arrayBuffer())
  if (/\.csv$/i.test(arquivo.name) || buf[0] !== 0x50) {
    const texto = textoDe(buf)
    if (/Correios/i.test(texto.slice(0, 200)) && /CARTAO POSTAGEM/.test(texto)) return lerCorreios(texto)
    throw new Error(`${arquivo.name}: CSV não reconhecido (esperado o extrato analítico de fatura dos Correios).`)
  }
  const [aba] = await lerXlsx(buf)
  const ls = (aba?.linhas || []).map(l => l.map(x => x == null ? '' : String(x)))
  if (/Lalamove/i.test(ls[0]?.[0] || '') || ls.some(l => l[0] === 'ORDER ID')) return lerLalamove(ls)
  if (/Relatório de envios/i.test(ls[0]?.[0] || '') || ls.some(l => l[0] === 'Código de envio')) return lerMelhorEnvio(ls)
  throw new Error(`${arquivo.name}: planilha não reconhecida (Lalamove Order Report ou Melhor Envio Relatório de envios).`)
}

// O mês está completo? Correios: a fatura fecha dia 15, então o mês precisa de duas faturas (envios até o dia 15
// e depois do dia 16). Lalamove e Melhor Envio: o relatório do mês. linhas: [{ origem, data }] do mês.
export function situacaoFretes(linhas, mes) {
  const de = o => linhas.filter(l => l.origem === o)
  const c = de('correios')
  const ini = c.some(l => String(l.data) <= `${mes}-15`), fim = c.some(l => String(l.data) >= `${mes}-16`)
  return {
    correios: { ok: ini && fim, detalhe: ini && fim ? `${c.length} lançamento(s)` : !c.length ? 'nenhuma fatura' : !ini ? 'falta a fatura que fecha dia 15 deste mês' : 'falta a fatura que fecha dia 15 do mês seguinte' },
    lalamove: { ok: de('lalamove').length > 0, detalhe: de('lalamove').length ? `${de('lalamove').length} corrida(s)` : 'sem relatório' },
    melhorenvio: { ok: de('melhorenvio').length > 0, detalhe: de('melhorenvio').length ? `${de('melhorenvio').length} etiqueta(s)` : 'sem relatório' },
  }
}
