import { useState } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'
import { ConferenciaEstoque } from './Embalagens'
import { ConferenciaMP, HistoricoCompras, DashMP, EvolucaoPrecos, HistoricoConsumo } from './MatPrimas'

// Hub de estoque: tudo que é "item em casa" — matéria-prima e embalagem
// juntas, com alternador onde a operação vale para os dois.
const ABAS = [
  { id:'situacao',   label:'📊 Situação',   sub:'Estoque atual, mínimos e alertas',        duplo:true },
  { id:'conferencia',label:'🔍 Conferência', sub:'Contagem física e impacto no estoque',   duplo:true },
  { id:'compras',    label:'🛒 Compras',     sub:'Lançamento de compras, notas e recebimentos', duplo:true },
  { id:'precos',     label:'📈 Preços',      sub:'Histórico e evolução do custo dos insumos',   duplo:false },
  { id:'consumo',    label:'📉 Consumo',     sub:'Baixas de matéria-prima por produto e por dia', duplo:false },
  { id:'pedidos',    label:'🏭 Pedidos à gráfica', sub:'Pedidos de rótulos e embalagens',  duplo:false },
]

export default function EstoqueHub() {
  const [aba, setAba] = useState('situacao')
  const [tipo, setTipo] = useState('mp')
  const cfg = ABAS.find(a => a.id === aba)

  return (
    <div className="page">
      <div className="tabs">
        {ABAS.map(a => (
          <button key={a.id} className={`tab${aba === a.id ? ' active' : ''}`}
            onClick={() => setAba(a.id)}>{a.label}</button>
        ))}
      </div>

      <div className="card card-pad" style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:14 }}>{cfg?.label}</div>
          <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:2 }}>{cfg?.sub}</div>
        </div>
        <div style={{ flex:1 }} />
        {cfg?.duplo && (
          <div style={{ display:'flex', gap:4 }}>
            {[['mp','🧂 Matéria-prima'],['emb','📦 Embalagens']].map(([k,l]) => (
              <button key={k} onClick={() => setTipo(k)}
                className={`btn btn-sm ${tipo === k ? 'btn-primary' : 'btn-ghost'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {aba === 'situacao'    && (tipo === 'mp' ? <DashMP />          : <Dashboard tipo="rotulo" />)}
      {aba === 'conferencia' && (tipo === 'mp' ? <ConferenciaMP />   : <ConferenciaEstoque />)}
      {aba === 'compras'     && (tipo === 'mp' ? <HistoricoCompras />: <Compras />)}
      {aba === 'precos'      && <EvolucaoPrecos />}
      {aba === 'consumo'     && <HistoricoConsumo />}
      {aba === 'pedidos'     && <Pedidos tipo="rotulo" />}
    </div>
  )
}
