import { useState } from 'react'
import FinDashboard from './FinDashboard'
import FinLancamentos from './FinLancamentos'
import FinFluxo from './FinFluxo'
import FinDRE from './FinDRE'
import FinCanais from './FinCanais'
import FinReconciliacao from './FinReconciliacao'
import FinConfig from './FinConfig'

const TABS = [
  { id:'dashboard',      label:'📊 Dashboard'        },
  { id:'receber',        label:'📈 A Receber'         },
  { id:'pagar',          label:'📉 A Pagar'           },
  { id:'fluxo',          label:'💰 Fluxo de Caixa'   },
  { id:'dre',            label:'📋 DRE'               },
  { id:'canais',         label:'🏷️ Canais'            },
  { id:'reconciliacao',  label:'🏦 Reconciliação'     },
  { id:'config',         label:'⚙️ Configurações'     },
]

export default function Financeiro() {
  const [tab, setTab] = useState('dashboard')
  return (
    <>
      <div className="tabs" style={{ marginBottom:0 }}>
        {TABS.map(t => (
          <button key={t.id} className={`tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==='dashboard'     && <FinDashboard />}
      {tab==='receber'       && <FinLancamentos tipo="receita" />}
      {tab==='pagar'         && <FinLancamentos tipo="despesa" />}
      {tab==='fluxo'         && <FinFluxo />}
      {tab==='dre'           && <FinDRE />}
      {tab==='canais'        && <FinCanais />}
      {tab==='reconciliacao' && <FinReconciliacao />}
      {tab==='config'        && <FinConfig />}
    </>
  )
}
