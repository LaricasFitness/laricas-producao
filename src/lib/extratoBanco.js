// Extrato do banco (conta corrente ou investimento) → linhas + saldo de cada fim de mês.
// Lê OFX (qualquer banco), CSV e .xlsx com colunas de data, valor (ou entrada/saída) e saldo:
//   C6 (Extrato_Conta_Corrente_C6Bank_*.xlsx): Data Lançamento, Data Contábil, Título, Descrição, Entrada, Saída, Saldo do Dia
//      (o saldo do dia é pela data contábil; o fim do mês é calculado pela data do lançamento, como no Bling)
//   Inter (Extrato-*-CSV.csv): Data Lançamento;Descrição;Valor;Saldo (saldo linha a linha)
// O saldo de fim de mês sai de: saldo antes da 1ª linha + soma das linhas até o último dia do mês.
import { lerXlsx, dataExcel } from './lerXlsx'

const r2 = n => Math.round(n * 100) / 100

// '1.234,56' / 'R$ -1.234,56' / '-0,00' / 1234.56 → número
export function numBR(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').replace(/R\$|\s/g, '')
  if (!s) return null
  const neg = /^\(.*\)$/.test(s) || /-/.test(s)
  s = s.replace(/[()+-]/g, '')
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

// '31/10/2026' / '31/10/2026 20:02' / '2026-10-31' / '20261031...' / nº de série do Excel → 'AAAA-MM-DD'
export function dataISO(v) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? dataExcel(v) : null
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const ultimoDiaMes = mes => { const [a, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}` }
const proxMes = mes => { const [a, m] = mes.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}` }

function decodificar(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const t = new TextDecoder('utf-8').decode(u8)
  return t.includes('�') ? new TextDecoder('windows-1252').decode(u8) : t
}

// CSV com ; ou , (aspas só quando o campo começa com aspas: o Inter põe aspas no meio da descrição)
function lerCSV(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/)
  const amostra = linhas.slice(0, 20).join('\n')
  const sep = (amostra.match(/;/g) || []).length >= (amostra.match(/,/g) || []).length / 2 ? ';' : ','
  return linhas.map(l => {
    const out = []
    let i = 0
    while (i <= l.length) {
      if (l[i] === '"') {
        let v = '', j = i + 1
        for (; j < l.length; j++) {
          if (l[j] === '"' && l[j + 1] === '"') { v += '"'; j++ } else if (l[j] === '"') break; else v += l[j]
        }
        const fim = l.indexOf(sep, j)
        out.push(v + (fim < 0 ? l.slice(j + 1) : l.slice(j + 1, fim)))
        i = fim < 0 ? l.length + 1 : fim + 1
      } else {
        const fim = l.indexOf(sep, i)
        out.push((fim < 0 ? l.slice(i) : l.slice(i, fim)).trim())
        i = fim < 0 ? l.length + 1 : fim + 1
      }
    }
    return out
  })
}

// ── OFX ──
function lerOFX(texto) {
  const tag = (s, n) => (s.match(new RegExp(`<${n}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || ''
  const linhas = [...texto.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)].map(m => {
    const b = m[1]
    return { data: dataISO(tag(b, 'DTPOSTED')), valor: numBR(tag(b, 'TRNAMT').replace(',', '.')) ?? 0, descricao: tag(b, 'MEMO') || tag(b, 'NAME'), id: tag(b, 'FITID') }
  }).filter(l => l.data)
  const bal = texto.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|$)/i)?.[1] || ''
  const saldo = bal ? numBR(tag(bal, 'BALAMT').replace(',', '.')) : null, dataSaldo = bal ? dataISO(tag(bal, 'DTASOF')) : null
  linhas.sort((a, b) => a.data.localeCompare(b.data))
  let saldoIni = null
  if (saldo != null) saldoIni = r2(saldo - linhas.filter(l => !dataSaldo || l.data <= dataSaldo).reduce((t, l) => t + l.valor, 0))
  return {
    banco: tag(texto, 'ORG') || tag(texto, 'BANKID'), conta: tag(texto, 'ACCTID'),
    de: dataISO(tag(texto, 'DTSTART')) || linhas[0]?.data, ate: dataISO(tag(texto, 'DTEND')) || linhas.at(-1)?.data,
    saldoIni, linhas, como: saldo != null ? 'saldo do OFX (LEDGERBAL)' : null,
  }
}

// ── Planilha (CSV ou xlsx): acha o cabeçalho e as colunas ──
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
function lerTabela(rows) {
  let h = -1, col = {}
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = (rows[i] || []).map(norm)
    const idx = re => r.findIndex(c => re.test(c))
    const data = idx(/^data( (do )?lancamento| da transacao| movimento)?$|^data$/), dataAlt = idx(/^data (contabil|valor)/)
    const valor = idx(/^valor( \(r\$\))?$|^valor\b/), ent = idx(/^(entrada|credito)s?\b/), sai = idx(/^(saida|debito)s?\b/)
    if ((data >= 0 || dataAlt >= 0) && (valor >= 0 || (ent >= 0 && sai >= 0))) {
      h = i
      col = { data: data >= 0 ? data : dataAlt, dataSaldo: dataAlt >= 0 ? dataAlt : null, valor, ent, sai,
        saldo: idx(/^saldo/), desc: [idx(/^titulo/), idx(/^descri|^historico|^lancamento$|^movimentacao$/)].filter(x => x >= 0) }
      break
    }
  }
  if (h < 0) throw new Error('Não achei as colunas do extrato (data e valor, ou entrada e saída). Exporte o extrato em OFX, CSV ou Excel (.xlsx).')
  const topo = rows.slice(0, h).map(r => (r || []).filter(x => x != null && x !== '').join(' ')).join('\n')
  const conta = (topo.match(/conta\D{0,12}?(\d[\d.-]{4,})/i) || [])[1]?.replace(/\D/g, '') || ''
  const periodo = topo.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|até|-)\s*(\d{2}\/\d{2}\/\d{4})/i)
  const banco = /\bC6\b/i.test(topo) ? 'C6' : /inter\b/i.test(topo) ? 'Inter' : ''
  const linhas = []
  for (const r of rows.slice(h + 1)) {
    if (!r) continue
    const data = dataISO(r[col.data])
    if (!data) continue
    const valor = col.valor >= 0 ? numBR(r[col.valor]) : (numBR(r[col.ent]) || 0) - Math.abs(numBR(r[col.sai]) || 0)
    if (valor == null) continue
    const desc = [...new Set(col.desc.map(i => String(r[i] ?? '').trim()).filter(Boolean))].join(' · ')
    linhas.push({ data, valor: r2(valor), descricao: desc, saldo: col.saldo >= 0 ? numBR(r[col.saldo]) : null, dataSaldo: col.dataSaldo != null ? dataISO(r[col.dataSaldo]) : null })
  }
  // em ordem cronológica (alguns bancos mandam do mais novo para o mais antigo)
  if (linhas.length > 1 && linhas[0].data > linhas.at(-1).data) linhas.reverse()
  // saldo antes da 1ª linha: saldo linha a linha (Inter) ou saldo do fim do dia (C6, pela data contábil)
  let saldoIni = null, como = null
  const comSaldo = linhas.filter(l => l.saldo != null)
  if (comSaldo.length === linhas.length && linhas.length) {
    let ok = 0
    for (let i = 1; i < linhas.length; i++) if (Math.abs(linhas[i - 1].saldo + linhas[i].valor - linhas[i].saldo) < 0.011) ok++
    if (linhas.length === 1 || ok >= (linhas.length - 1) * 0.95) { saldoIni = r2(linhas[0].saldo - linhas[0].valor); como = 'saldo linha a linha' }
    else {
      for (const k of ['dataSaldo', 'data']) {
        const dias = []
        for (const l of linhas) { const d = l[k] || l.data, u = dias.at(-1); if (u && u.d === d) { u.mov += l.valor; u.s = l.saldo } else dias.push({ d, mov: l.valor, s: l.saldo }) }
        if (dias.some((x, i) => i && x.d < dias[i - 1].d)) continue
        let quebras = 0
        for (let i = 1; i < dias.length; i++) if (Math.abs(dias[i - 1].s + dias[i].mov - dias[i].s) > 0.011) quebras++
        if (quebras === 0) { saldoIni = r2(dias[0].s - dias[0].mov); como = k === 'dataSaldo' ? 'saldo do dia pela data contábil' : 'saldo do fim do dia'; break }
      }
    }
  }
  return {
    banco, conta, de: periodo ? dataISO(periodo[1]) : linhas[0]?.data, ate: periodo ? dataISO(periodo[2]) : linhas.at(-1)?.data,
    saldoIni, como, linhas: linhas.map(({ data, valor, descricao }) => ({ data, valor, descricao })),
  }
}

// Arquivo → { banco, conta, de, ate, saldoIni, como, linhas: [{ data, valor, descricao, chave }], meses: [{ mes, saldo }] }
export async function lerExtrato(nome, buf) {
  const u8 = new Uint8Array(buf)
  let ext
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    const abas = await lerXlsx(u8)
    let erro
    for (const a of abas) { try { ext = lerTabela(a.linhas); break } catch (e) { erro = e } }
    if (!ext) throw erro || new Error('Planilha vazia.')
  } else if (u8[0] === 0xd0 && u8[1] === 0xcf) {
    throw new Error('Arquivo .xls antigo: abra no Excel e salve como .xlsx, ou exporte o extrato do banco em OFX ou CSV.')
  } else if (u8[0] === 0x25 && u8[1] === 0x50) {
    throw new Error('PDF não dá para ler: exporte o extrato em OFX, CSV ou Excel.')
  } else {
    const texto = decodificar(u8)
    ext = /<OFX>|OFXHEADER/i.test(texto) ? lerOFX(texto) : lerTabela(lerCSV(texto))
  }
  if (!ext.linhas.length) throw new Error('Nenhum lançamento no extrato.')
  // chave estável: FITID do OFX; senão data|valor|descrição|ocorrência (reimportar não duplica)
  const vistos = {}
  ext.linhas = ext.linhas.map(l => {
    if (l.id) return { data: l.data, valor: r2(l.valor), descricao: l.descricao, chave: 'ofx:' + l.id }
    const base = `${l.data}|${r2(l.valor).toFixed(2)}|${l.descricao}`
    vistos[base] = (vistos[base] || 0) + 1
    return { data: l.data, valor: r2(l.valor), descricao: l.descricao, chave: `${base}|${vistos[base]}` }
  })
  ext.banco = ext.banco || (/c6/i.test(nome) ? 'C6' : /inter/i.test(nome) ? 'Inter' : '')
  ext.id = `${ext.banco || 'banco'}:${ext.conta || nome.replace(/[^\w]+/g, '_').slice(0, 40)}`
  ext.meses = mesesDoExtrato(ext)
  return ext
}

// Saldo no fim de cada mês que o extrato cobre até o último dia
export function mesesDoExtrato(ext) {
  if (ext.saldoIni == null || !ext.de || !ext.ate) return []
  const out = []
  for (let mes = ext.de.slice(0, 7); ultimoDiaMes(mes) <= ext.ate; mes = proxMes(mes)) {
    const fim = ultimoDiaMes(mes)
    out.push({ mes, saldo: r2(ext.saldoIni + ext.linhas.filter(l => l.data <= fim).reduce((t, l) => t + l.valor, 0)) })
  }
  return out
}

// Banco × Bling: casa cada linha do banco com um lançamento do Bling de mesmo valor (com sinal) e data
// até `folga` dias de diferença, o mais próximo primeiro. O que sobra de cada lado é o que falta no outro.
// banco: [{ data, valor, descricao }], bling: [{ data, valor (com sinal), ... }]
export function conciliarExtrato(banco, bling, folga = 4) {
  const dias = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5
  const livres = bling.map((b, i) => ({ ...b, i }))
  const porValor = {}
  for (const b of livres) (porValor[r2(b.valor).toFixed(2)] ||= []).push(b)
  const usados = new Set(), pares = [], soBanco = []
  // primeiro os de mesma data, depois os mais próximos
  const cands = []
  banco.forEach((l, j) => {
    for (const b of porValor[r2(l.valor).toFixed(2)] || []) { const d = dias(l.data, b.data); if (d <= folga) cands.push({ j, i: b.i, d }) }
  })
  cands.sort((a, b) => a.d - b.d || a.j - b.j)
  const casadoBanco = new Set()
  for (const c of cands) {
    if (casadoBanco.has(c.j) || usados.has(c.i)) continue
    casadoBanco.add(c.j); usados.add(c.i); pares.push({ banco: banco[c.j], bling: bling[c.i], dias: c.d })
  }
  // depois, em grupo: o Bling junta várias linhas do banco num lançamento (repasse do iFood da semana,
  // 99 Food) ou o contrário. Entradas (ou saídas) que sobraram num dia, ou em 2 a `folga` dias seguidos,
  // com a mesma soma dos dois lados, se casam juntas.
  const grupos = []
  const sobraB = banco.map((l, j) => ({ l, j })).filter(x => !casadoBanco.has(x.j))
  const sobraL = bling.map((l, i) => ({ l, i })).filter(x => !usados.has(x.i))
  const datas = [...new Set([...sobraB.map(x => x.l.data), ...sobraL.map(x => x.l.data)])].sort()
  for (let w = 0; w <= folga; w++) {
    for (const sinal of [1, -1]) {
      for (const d0 of datas) {
        const d1 = new Date(Date.parse(d0) + w * 864e5).toISOString().slice(0, 10)
        const gb = sobraB.filter(x => !casadoBanco.has(x.j) && x.l.data >= d0 && x.l.data <= d1 && Math.sign(x.l.valor) === sinal)
        const gl = sobraL.filter(x => !usados.has(x.i) && x.l.data >= d0 && x.l.data <= d1 && Math.sign(x.l.valor) === sinal)
        if (!gb.length || !gl.length || gb.length + gl.length < 3) continue
        if (Math.abs(gb.reduce((t, x) => t + x.l.valor, 0) - gl.reduce((t, x) => t + x.l.valor, 0)) >= 0.005) continue
        gb.forEach(x => casadoBanco.add(x.j)); gl.forEach(x => usados.add(x.i))
        grupos.push({ banco: gb.map(x => x.l), bling: gl.map(x => x.l) })
      }
    }
  }
  banco.forEach((l, j) => { if (!casadoBanco.has(j)) soBanco.push(l) })
  const soBling = bling.filter((_, i) => !usados.has(i))
  return { pares, grupos, soBanco, soBling }
}
