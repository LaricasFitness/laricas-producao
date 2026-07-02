import { useState, useEffect } from 'react'
import FinDashboard from './FinDashboard'
import FinLancamentos from './FinLancamentos'
import FinFluxo from './FinFluxo'
import FinDRE from './FinDRE'
import FinCanais from './FinCanais'
import FinCanalDespesas from './FinCanalDespesas'
import FinOrcamento from './FinOrcamento'
import FinSazonalidade from './FinSazonalidade'
import FinReconciliacao from './FinReconciliacao'
import FinImportarFatura from './FinImportarFatura'
import FinExtrato from './FinExtrato'
import FinAlertas from './FinAlertas'
import FinConfig from './FinConfig'
import { verificarEDispararAlertas } from '../lib/alertas'

const TABS = [
  { id:'dashboard',     label:'📊 Dashboard'       },
  { id:'receber',       label:'📈 A Receber'        },
  { id:'pagar',         label:'📉 A Pagar'          },
  { id:'fluxo',         label:'💰 Fluxo de Caixa'  },
  { id:'dre',           label:'📋 DRE'              },
  { id:'canais',        label:'🏷️ DRE por Canal'   },
  { id:'canal_desp',    label:'⚙️ Desp. por Canal' },
  { id:'orcamento',     label:'🎯 Orçamento'        },
  { id:'sazonalidade',  label:'📅 Sazonalidade'     },
  { id:'reconciliacao', label:'🏦 Reconciliação'    },
  { id:'fatura',        label:'💳 Importar Fatura'  },
  { id:'extrato',       label:'📒 Extrato Geral'    },
  { id:'alertas',       label:'🔔 Alertas'          },
  { id:'config',        label:'⚙️ Config'           },
]

export default function Financeiro() {
  const [tab, setTab] = useState('dashboard')
  useEffect(() => { verificarEDispararAlertas().catch(console.error) }, [])
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
      {tab==='canal_desp'   && <FinCanalDespesas />}
      {tab==='orcamento'    && <FinOrcamento />}
      {tab==='sazonalidade' && <FinSazonalidade />}
      {tab==='reconciliacao'&& <FinReconciliacao />}
      {tab==='fatura'       && <FinImportarFatura />}
      {tab==='extrato'      && <FinExtrato />}
      {tab==='alertas'      && <FinAlertas />}
      {tab==='config'       && <FinConfig />}
    </>
  )
}
