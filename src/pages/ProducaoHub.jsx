import { useState } from 'react'
import RegistroProducao from './Producao'
import Planejamento from './Planejamento'
import Analise from './Analise'
import Log from './Log'

export default function ProducaoHub({ onIrLogistica }) {
  const [sub, setSub] = useState('registro')

  return (
    <>
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'registro' ? ' active' : ''}`} onClick={() => setSub('registro')}>
          📋 Registro
        </button>
        <button className={`tab${sub === 'planejamento' ? ' active' : ''}`} onClick={() => setSub('planejamento')}>
          🗓️ Planejamento
        </button>
        <button className={`tab${sub === 'analise' ? ' active' : ''}`} onClick={() => setSub('analise')}>
          📈 Análise
        </button>
        <button className={`tab${sub === 'log' ? ' active' : ''}`} onClick={() => setSub('log')}>
          📅 Log
        </button>
      </div>

      {sub === 'registro'     && <RegistroProducao />}
      {sub === 'planejamento' && <Planejamento onIrLogistica={onIrLogistica} />}
      {sub === 'analise'      && <Analise />}
      {sub === 'log'          && <Log />}
    </>
  )
}
