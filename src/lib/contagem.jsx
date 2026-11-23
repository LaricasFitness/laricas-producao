import { supabase } from '../supabase'
import { perguntar } from './perguntar'

// Contagem física e compras — mesma regra para matéria-prima ('mp') e embalagem/rótulo ('emb'):
// a data da nota não diz quando a mercadoria chegou; compra lançada ANTES da última contagem já estava
// nela (o saldo virou o número contado). Nota com data até a última contagem, lançada depois, só quem
// recebeu sabe: pergunta "já estava na contagem?" e grava entrou_no_saldo = false se sim.
// Contagens: MP em conferencia_mp e mp_inventarios; embalagem em inventarios (cada conferência grava um).

// ── Contagem da semana × fechamento do mês ──────────────────────────────────
// Toda semana contam-se só os itens principais (contagem_semanal = true, ⭐ na tela de Conferência);
// no último dia do mês, todos — é o estoque final do CMV (contagem até 3 dias antes ainda vale).
export const pertoDoFimDoMes = (hoje = new Date()) =>
  hoje.getDate() >= new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() - 2
export const modoContagemInicial = temPrincipais => (!temPrincipais || pertoDoFimDoMes()) ? 'mes' : 'semana'

export async function marcarContagemSemanal(tabela, id, valor) {
  const { error } = await supabase.from(tabela).update({ contagem_semanal: valor }).eq('id', id)
  if (error) throw new Error(/contagem_semanal/.test(error.message) ? 'Aplique o estoque_embalagem.sql no Supabase.' : error.message)
}

export function BarraContagem({ modo, onModo, principais, total }) {
  return (
    <div className="card card-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
      <button className={`btn btn-sm ${modo === 'semana' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onModo('semana')}>
        ⭐ Contagem da semana ({principais})
      </button>
      <button className={`btn btn-sm ${modo === 'mes' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onModo('mes')}>
        📋 Fechamento do mês — todos ({total})
      </button>
      <span style={{ fontSize: 11, color: 'var(--gray-500)' }}>
        {modo === 'mes'
          ? 'No último dia do mês conte todos os itens: é o estoque final do CMV.'
          : 'Só os itens principais. Clique na ⭐ de um item para incluir ou tirar da contagem da semana.'}
      </span>
    </div>
  )
}

export function Estrela({ ativo, onClick }) {
  return (
    <button type="button" onClick={onClick} title={ativo ? 'Na contagem da semana — clique para tirar' : 'Incluir na contagem da semana'}
      style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, padding: '0 6px 0 0', opacity: ativo ? 1 : .3, lineHeight: 1 }}>
      {ativo ? '⭐' : '☆'}
    </button>
  )
}

// Última contagem do item: { data, ts } ou null
export async function ultimaContagem(tipo, id) {
  if (!id) return null
  const consultas = tipo === 'emb'
    ? [supabase.from('inventarios').select('data_inventario, criado_em').eq('embalagem_id', id).order('criado_em', { ascending: false }).limit(1)]
    : [
      supabase.from('conferencia_mp').select('data_conferencia, criado_em').eq('materia_prima_id', id).order('criado_em', { ascending: false }).limit(1),
      supabase.from('mp_inventarios').select('data_inventario, criado_em').eq('materia_prima_id', id).order('criado_em', { ascending: false }).limit(1),
    ]
  const res = await Promise.all(consultas)
  return res.map(r => r.data?.[0]).filter(Boolean)
    .map(r => ({ data: r.data_conferencia || r.data_inventario, ts: r.criado_em }))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0] || null
}

// itens: [{ id, nome }]. Devolve o conjunto de ids que NÃO somam ao saldo, ou null para voltar.
export async function perguntarSeJaContada(tipo, itens, dataCompra) {
  const pendentes = []
  for (const it of itens) {
    const cont = await ultimaContagem(tipo, it.id)
    if (cont && dataCompra <= cont.data) pendentes.push({ ...it, contagem: cont.data })
  }
  if (!pendentes.length) return new Set()
  const br = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
  const resp = await perguntar({
    titulo: 'Essa mercadoria já tinha sido contada?',
    texto: `A nota é de ${br(dataCompra)}, mas houve contagem física nesse dia ou depois. Quando contaram, esta mercadoria já estava no estoque?`,
    itens: pendentes.map(p => `${p.nome} (contagem de ${br(p.contagem)})`),
    opcoes: [
      { valor: 'depois', rotulo: 'Não, chegou depois da contagem — somar ao estoque', classe: 'btn-primary' },
      { valor: 'contada', rotulo: 'Sim, já estava na contagem — não somar' },
      { valor: null, rotulo: 'Voltar' },
    ],
  })
  if (resp === null) return null
  return new Set(resp === 'contada' ? pendentes.map(p => p.id) : [])
}
