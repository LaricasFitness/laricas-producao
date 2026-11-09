// Busca de nota fiscal pelo número ou pelo código de barras da DANFE.
//
// O código de barras (e o QR code da NFC-e) traz a chave de acesso de 44 dígitos:
//   UF(2) AAMM(4) CNPJ do emitente(14) modelo(2) série(3) número(9) tipo emissão(1) código(8) DV(1)
// Então dá para achar a nota pelo número que já está gravado na compra,
// sem guardar a chave no banco.

const digitos = t => String(t ?? '').replace(/\D/g, '')
const semZeros = d => d.replace(/^0+/, '')

// Lê o que foi digitado/bipado. Devolve null se não houver número.
export function lerBuscaNF(texto) {
  const bruto = String(texto ?? '')
  // QR code da NFC-e vem como URL "...?p=<chave>|..." — pega a 1ª sequência de 44 dígitos
  const chave = (bruto.replace(/\s/g, '').match(/\d{44}/) || [])[0]
  if (chave) {
    const cnpj = chave.slice(6, 20)
    return {
      chave,
      numero: semZeros(chave.slice(25, 34)) || '0',
      serie: semZeros(chave.slice(22, 25)) || '0',
      emissao: `${chave.slice(4, 6)}/20${chave.slice(2, 4)}`,
      cnpj: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
      modelo: chave.slice(20, 22) === '65' ? 'NFC-e' : 'NF-e',
    }
  }
  const numero = semZeros(digitos(bruto))
  return numero ? { chave: null, numero } : null
}

// Número da nota como foi gravado ("000.025.049", "Cupom fiscal 037701", ou a própria chave)
function numeroGravado(valor) {
  const d = digitos(valor)
  if (d.length === 44) return semZeros(d.slice(25, 34))
  return semZeros(d)
}

// A compra gravada com 'valor' corresponde à busca?
// Pela chave: número exato. Pelo número digitado: contém (aceita digitar só parte).
export function nfCombina(valor, busca) {
  if (!busca) return true
  const n = numeroGravado(valor)
  if (!n) return false
  return busca.chave ? n === busca.numero : n.includes(busca.numero)
}

// Texto curto explicando o que foi lido, para mostrar acima da lista
export function descreverBuscaNF(busca) {
  if (!busca) return ''
  if (!busca.chave) return `Notas com número contendo ${busca.numero}`
  return `${busca.modelo} nº ${busca.numero} · série ${busca.serie} · emitida em ${busca.emissao} · CNPJ ${busca.cnpj}`
}
