import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { ehSazonal, categoriaOculta, MARCA_SAZONAL } from './sazonal'

// Categorias de produto/embalagem: as de sempre + as que já existem no cadastro.
// "＋ Nova categoria…" cria uma nova (para produto sazonal, termine com [SAZONAL]).
export const CATEGORIAS_BASE = [
  'Pão de Mel 100g', 'Pão de Mel 60g', 'Mini Pão de Mel 30g', 'Lata Mini 240g',
  'Bolinho 100g', 'Potinho 60g', 'Potão 280g', 'Barra 180g', 'Bombom', 'Outros',
]

export function rotuloCategoria(cat) {
  if (!ehSazonal(cat)) return cat
  return categoriaOculta(cat) ? `${cat} · fora de temporada` : cat
}

const NOVA = '__nova__'

export function SelectCategoria({ value, onChange, className = 'form-input', style }) {
  const [doBanco, setDoBanco] = useState([])
  useEffect(() => {
    supabase.from('embalagens').select('categoria').then(({ data }) =>
      setDoBanco([...new Set((data || []).map(r => r.categoria).filter(Boolean))]))
  }, [])

  const extras = [...new Set([...doBanco, value].filter(c => c && !CATEGORIAS_BASE.includes(c)))].sort()
  const opcoes = [...CATEGORIAS_BASE, ...extras]

  function escolher(v) {
    if (v !== NOVA) { onChange(v); return }
    const nome = window.prompt(`Nome da nova categoria.\nPara produto sazonal (some do sistema fora da temporada), termine com ${MARCA_SAZONAL} — ex.: "Chocotone ${MARCA_SAZONAL}".`)
    if (nome && nome.trim()) onChange(nome.trim().replace(/\s+/g, ' '))
  }

  return (
    <select className={className} style={style} value={value || ''} onChange={e => escolher(e.target.value)}>
      {!value && <option value="">Selecione…</option>}
      {opcoes.map(c => <option key={c} value={c}>{rotuloCategoria(c)}</option>)}
      <option value={NOVA}>＋ Nova categoria…</option>
    </select>
  )
}
