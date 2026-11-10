import JSZip from 'jszip'

// Leitor mínimo de .xlsx (só valores, sem fórmulas nem formatação) — usa o jszip que já existe.
// Devolve [{ nome, linhas: [[célula, ...], ...] }] na ordem das abas. Número vira Number;
// texto, string; data do Excel continua como número de série (use dataExcel para converter).

const attr = (tag, nome) => (tag.match(new RegExp(`\\s${nome}="([^"]*)"`)) || [])[1]
const desescapar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
// texto de um <si> ou <is>: junta todos os <t> (texto com formatação vem picado em <r>)
const textoDe = xml => desescapar([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
const colIndice = ref => {
  const letras = ref.replace(/\d+/g, '')
  let n = 0
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

export async function lerXlsx(dados) {
  const zip = await JSZip.loadAsync(dados)
  const ler = async caminho => zip.file(caminho)?.async('string')
  const compart = await ler('xl/sharedStrings.xml')
  const strings = compart ? [...compart.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textoDe(m[1])) : []

  const wb = await ler('xl/workbook.xml') || ''
  const rels = await ler('xl/_rels/workbook.xml.rels') || ''
  const alvo = {}
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) alvo[attr(m[0], 'Id')] = attr(m[0], 'Target')
  const abas = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => ({
    nome: desescapar(attr(m[0], 'name') || ''),
    caminho: 'xl/' + (alvo[attr(m[0], 'r:id')] || '').replace(/^\/?xl\//, ''),
  }))

  const out = []
  for (const aba of abas) {
    const xml = await ler(aba.caminho)
    if (!xml) continue
    const linhas = []
    for (const lr of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = +attr(lr[0], 'r') - 1
      const linha = []
      for (const c of lr[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`
        const ref = attr(tag, 'r'), t = attr(tag, 't')
        const corpo = c[2] || ''
        const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        let valor = null
        if (t === 's') valor = strings[+v] ?? ''
        else if (t === 'inlineStr') valor = textoDe(corpo)
        else if (t === 'str' || t === 'e') valor = v != null ? desescapar(v) : ''
        else if (t === 'b') valor = v === '1'
        else if (v != null) valor = Number(v)
        linha[ref ? colIndice(ref) : linha.length] = valor
      }
      linhas[r >= 0 ? r : linhas.length] = linha
    }
    out.push({ nome: aba.nome, linhas: Array.from(linhas, l => l || []) })
  }
  return out
}

// Número de série do Excel → 'AAAA-MM-DD'
export const dataExcel = n => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const d = new Date(Math.round((n - 25569) * 86400000))
  return d.toISOString().slice(0, 10)
}
