import { useState } from 'react'
import Dashboard from './Dashboard'
import Pedidos from './Pedidos'
import Compras from './Compras'
import { ConferenciaEstoque } from './Embalagens'
import { ConferenciaMP, HistoricoCompras, DashMP, EvolucaoPrecos, HistoricoConsumo } from './MatPrimas'

// Hub de estoque: tudo que é "item em casa" — matéria-prima e embalagem
// juntas, com alternador onde a operação vale para os dois.
// 'opcoes' = o que a aba alterna. Conferência e Compras de embalagem já
// listam rótulo e filme juntos na própria tela, então não precisam separar.
const ABAS = [
  { id:'situacao',   label:'📊 Situação',    sub:'Estoque atual, mínimos e alertas',              opcoes:['mp','rotulo','emb'] },
  { id:'conferencia',label:'🔍 Conferência',  sub:'Contagem física e impacto no estoque',          opcoes:['mp','pack'] },
  { id:'compras',    label:'🛒 Compras',      sub:'Lançamento de compras, notas e recebimentos',   opcoes:['mp','pack'] },
  { id:'precos',     label:'📈 Preços',       sub:'Histórico e evolução do custo dos insumos',     opcoes:[] },
  { id:'consumo',    label:'📉 Consumo',      sub:'Baixas de matéria-prima por produto e por dia', opcoes:[] },
  { id:'pedidos',    label:'🏭 Pedidos à gráfica', sub:'Pedidos de rótulos e embalagens (filtro na própria tela)', opcoes:[] },
]

const ROTULOS = {
  mp:     '🧂 Matéria-prima',
  rotulo: '🏷️ Rótulos',
  emb:    '📦 Embalagens',
  pack:   '📦 Rótulos e embalagens',
}

export default function EstoqueHub() {
  const [aba, setAba] = useState('situacao')
  const [tipo, setTipo] = useState('mp')
  const cfg = ABAS.find(a => a.id === aba)

  // Se o tipo atual não existe na aba escolhida, cai no primeiro disponível
  const opcoes = cfg?.opcoes || []
  const tipoAtivo = opcoes.includes(tipo) ? tipo : (opcoes[0] || null)

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
        {opcoes.length > 1 && (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {opcoes.map(k => (
              <button key={k} onClick={() => setTipo(k)}
                className={`btn btn-sm ${tipoAtivo === k ? 'btn-primary' : 'btn-ghost'}`}>{ROTULOS[k]}</button>
            ))}
          </div>
        )}
      </div>

      {aba === 'situacao'    && (tipoAtivo === 'mp'
        ? <DashMP />
        : <Dashboard key={tipoAtivo} tipo={tipoAtivo === 'rotulo' ? 'rotulo' : 'embalagem'} />)}
      {aba === 'conferencia' && (tipoAtivo === 'mp' ? <ConferenciaMP />    : <ConferenciaEstoque />)}
      {aba === 'compras'     && (tipoAtivo === 'mp' ? <HistoricoCompras /> : <Compras />)}
      {aba === 'precos'      && <EvolucaoPrecos />}
      {aba === 'consumo'     && <HistoricoConsumo />}
      {aba === 'pedidos'     && <Pedidos />}
    </div>
  )
}
