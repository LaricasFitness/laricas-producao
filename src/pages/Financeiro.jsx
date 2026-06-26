import { useState, useEffect } from 'react'
import FinDashboard from './FinDashboard'
import FinLancamentos from './FinLancamentos'
import FinFluxo from './FinFluxo'
import FinDRE from './FinDRE'
import FinCanais from './FinCanais'
import FinOrcamento from './FinOrcamento'
import FinSazonalidade from './FinSazonalidade'
import FinReconciliacao from './FinReconciliacao'
import FinAlertas from './FinAlertas'
import FinConfig from './FinConfig'
import { verificarEDispararAlertas } from '../lib/alertas'

const TABS = [
  { id:'dashboard',     label:'📊 Dashboard'     },
  { id:'receber',       label:'📈 A Receber'      },
  { id:'pagar',         label:'📉 A Pagar'        },
  { id:'fluxo',         label:'💰 Fluxo de Caixa' },
  { id:'dre',           label:'📋 DRE'            },
  { id:'canais',        label:'🏷️ Canais'         },
  { id:'orcamento',     label:'🎯 Orçamento'      },
  { id:'sazonalidade',  label:'📅 Sazonalidade'   },
  { id:'reconciliacao', label:'🏦 Reconciliação'  },
  { id:'alertas',       label:'🔔 Alertas'        },
  { id:'config',        label:'⚙️ Config'         },
]

export default function Financeiro() {
  const [tab, setTab] = useState('dashboard')

  useEffect(() => {
    // Verifica e dispara alertas ao abrir o módulo financeiro
    verificarEDispararAlertas().catch(console.error)
  }, [])

  return (
    <>
      <div className="tabs" style={{ marginBottom:0 }}>
        {TABS.map(t => (
          <button key={t.id} className={`tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==='dashboard'    && <FinDashboard />}
      {tab==='receber'      && <FinLancamentos tipo="receita" />}
      {tab==='pagar'        && <FinLancamentos tipo="despesa" />}
      {tab==='fluxo'        && <FinFluxo />}
      {tab==='dre'          && <FinDRE />}
      {tab==='canais'       && <FinCanais />}
      {tab==='orcamento'    && <FinOrcamento />}
      {tab==='sazonalidade' && <FinSazonalidade />}
      {tab==='reconciliacao'&& <FinReconciliacao />}
      {tab==='alertas'      && <FinAlertas />}
      {tab==='config'       && <FinConfig />}
    </>
  )
}
