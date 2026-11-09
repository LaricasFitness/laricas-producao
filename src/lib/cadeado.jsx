import { useState } from 'react'
import { supabase } from '../supabase'
import { Lock, LockOpen } from 'lucide-react'

// Cadeado de conferência nas compras (mp_compras e recebimentos).
// Fechado = alguém conferiu que o lançamento está certo: não pode mais ser
// editado nem excluído. Só administrador reabre. O banco também trava
// (trigger em cadeado_compras.sql), então vale para qualquer tela.

const AVISO_SQL = 'O cadeado ainda não está ativo no banco: aplique o arquivo cadeado_compras.sql no Supabase.'

function usuarioAtual() {
  try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
}

export const conferido = r => !!r?.conferido_em

export function descreverConferencia(r) {
  if (!r?.conferido_em) return ''
  const quando = new Date(r.conferido_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  return `Conferido${r.conferido_por ? ` por ${r.conferido_por}` : ''} em ${quando}`
}

// Mensagem amigável quando o banco recusa por causa do cadeado
export function erroCadeado(error) {
  const m = error?.message || String(error || '')
  if (/cadeado/i.test(m)) return m
  if (/conferido/i.test(m)) return AVISO_SQL
  return null
}

export function BotaoCadeado({ tabela, registro, onMudou }) {
  const [salvando, setSalvando] = useState(false)
  const fechado = conferido(registro)
  const u = usuarioAtual()
  const admin = u?.perfil === 'admin'
  const desc = descreverConferencia(registro)

  async function clicar(e) {
    e.stopPropagation()
    if (fechado) {
      if (!admin) { alert(`${desc}.\n\nSó um administrador pode abrir o cadeado.`); return }
      if (!window.confirm(`${desc}.\n\nAbrir o cadeado? O lançamento volta a poder ser editado e excluído.`)) return
    } else if (!admin && !window.confirm(
      'Fechar o cadeado?\n\nVocê confirma que este lançamento está certo. Depois disso ele não pode mais ser editado nem excluído — só um administrador reabre.')) return

    setSalvando(true)
    const { error } = await supabase.from(tabela)
      .update(fechado
        ? { conferido_em: null, conferido_por: null }
        : { conferido_em: new Date().toISOString(), conferido_por: u?.nome || null })
      .eq('id', registro.id)
    setSalvando(false)
    if (error) { alert(erroCadeado(error) || 'Não consegui salvar: ' + error.message); return }
    onMudou?.()
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={clicar} disabled={salvando}
      title={fechado ? `${desc}${admin ? ' — clique para abrir' : ''}` : 'Conferido? Feche o cadeado: o lançamento não poderá mais ser editado'}
      style={{ fontSize: 11, color: fechado ? 'var(--ok)' : 'var(--gray-400)' }}>
      {fechado ? <Lock size={12} /> : <LockOpen size={12} />}
    </button>
  )
}
