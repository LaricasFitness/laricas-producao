import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { carregarEmbalagens } from '../lib/data'
import { Save, RefreshCw, CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react'

// Itens fixos das fases internas
const MASSAS = ['Massa - Pão de Mel', 'Massa - Bolo de Cenoura', 'Massa - Chocotone']
const RECHEIOS = ['Brigadeiro de Whey','Beijinho de Whey','Cookies\'n Cream','Pistache Cremoso','Creme de Avelã Trufado','Romeu e Julieta','Avelã Crunch','Bueníssimo','Doce de Leite']
const COBERTURAS = ['Branca','Ao Leite']

const FASES = [
  { id: 1, label: 'Produção de itens',     emoji: '📦' },
  { id: 2, label: 'Produção de massas',    emoji: '🍞' },
  { id: 3, label: 'Produção de recheios',  emoji: '🍫' },
  { id: 4, label: 'Recheio potinhos/potões',emoji: '🥄' },
  { id: 5, label: 'Coberturas',            emoji: '🍬' },
  { id: 6, label: 'Desperdício',           emoji: '⚠️' },
]

function FaseHeader({ fase, total }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-light)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
        Fase {fase.id} de {total}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gray-800)' }}>
        {fase.emoji} {fase.label}
      </div>
    </div>
  )
}

// Fase 1 — Produção de itens (desconta embalagem)
function Fase1({ embalagens, qtds, setQtds }) {
  const categorias = embalagens.reduce((acc, e) => {
    const cat = e.categoria || 'Outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(e)
    return acc
  }, {})

  const ORDER = ['Pão de Mel 100g','Mini Pão de Mel 30g','Lata Mini 240g','Potinho 60g','Potão 280g','Barra 180g','Bombom','Outros']
  const sorted = ORDER.filter(c => categorias[c]).concat(Object.keys(categorias).filter(c => !ORDER.includes(c)))

  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16, lineHeight: 1.5 }}>
        Preencha <strong>quantas unidades</strong> de cada produto foram produzidas hoje.
        Deixe em branco os que não foram produzidos.
      </p>
      {sorted.map(cat => (
        <div key={cat} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-light)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid var(--purple-pale)' }}>
            {cat}
          </div>
          {categorias[cat].map(emb => {
            const val = qtds[emb.id] ?? ''
            const filled = val !== '' && parseInt(val) > 0
            return (
              <div key={emb.id} className="prod-row">
                <div className="prod-nome">{emb.nome}</div>
                <input type="number" min={0} placeholder="0"
                  className={`qty-input${filled ? ' filled' : ''}`}
                  value={val}
                  onChange={e => setQtds(prev => ({ ...prev, [emb.id]: e.target.value }))} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Fase 2 — Massas
function Fase2({ vals, setVals }) {
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16, lineHeight: 1.5 }}>
        Informe <strong>quantas receitas</strong> de cada massa foram produzidas hoje.
      </p>
      {MASSAS.map(item => {
        const val = vals[item] ?? ''
        const filled = val !== '' && parseFloat(val) > 0
        return (
          <div key={item} className="prod-row">
            <div className="prod-nome">{item}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min={0} step={0.5} placeholder="0"
                className={`qty-input${filled ? ' filled' : ''}`}
                value={val}
                onChange={e => setVals(prev => ({ ...prev, [item]: e.target.value }))} />
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>receitas</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Fase 3 e 4 compartilham os mesmos recheios — label diferente
function FaseRecheios({ vals, setVals, label }) {
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16, lineHeight: 1.5 }}>
        Informe <strong>quantas receitas</strong> de cada {label} foram produzidas hoje.
      </p>
      {RECHEIOS.map(item => {
        const val = vals[item] ?? ''
        const filled = val !== '' && parseFloat(val) > 0
        return (
          <div key={item} className="prod-row">
            <div className="prod-nome">{item}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min={0} step={0.5} placeholder="0"
                className={`qty-input${filled ? ' filled' : ''}`}
                value={val}
                onChange={e => setVals(prev => ({ ...prev, [item]: e.target.value }))} />
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>receitas</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Fase 5 — Coberturas
function Fase5({ vals, setVals }) {
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16, lineHeight: 1.5 }}>
        Informe <strong>quantos pacotes</strong> de cada cobertura foram utilizados hoje.
      </p>
      {COBERTURAS.map(item => {
        const val = vals[item] ?? ''
        const filled = val !== '' && parseFloat(val) > 0
        return (
          <div key={item} className="prod-row">
            <div className="prod-nome">Cobertura {item}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min={0} step={1} placeholder="0"
                className={`qty-input${filled ? ' filled' : ''}`}
                value={val}
                onChange={e => setVals(prev => ({ ...prev, [item]: e.target.value }))} />
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>pacotes</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Fase 6 — Desperdício
function Fase6({ itens, setItens }) {
  function addItem() { setItens(prev => [...prev, { item: '', ocorrido: '' }]) }
  function upd(i, k, v) { setItens(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r)) }
  function rem(i) { setItens(prev => prev.filter((_, idx) => idx !== i)) }

  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 16, lineHeight: 1.5 }}>
        Registre qualquer desperdício ocorrido hoje — produto, ingrediente, embalagem ou outro.
        Deixe em branco se não houve nada.
      </p>
      {itens.map((r, i) => (
        <div key={i} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">O que foi desperdiçado</label>
              <input className="form-input" placeholder="Ex: 5 unid. Pão de Mel Brigadeiro" value={r.item} onChange={e => upd(i, 'item', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">O que aconteceu</label>
              <input className="form-input" placeholder="Ex: Queimou no forno" value={r.ocorrido} onChange={e => upd(i, 'ocorrido', e.target.value)} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end', color: 'var(--danger)' }} onClick={() => rem(i)}>
            🗑 Remover
          </button>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={addItem} style={{ marginTop: 4 }}>
        + Adicionar item de desperdício
      </button>
    </div>
  )
}

export default function Producao() {
  const [step, setStep] = useState(0) // 0 = identificação, 1-6 = fases
  const [nome, setNome] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [horario] = useState(() => {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  })

  const [embalagens, setEmbalagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Dados de cada fase
  const [qtdsFase1, setQtdsFase1] = useState({})
  const [valsFase2, setValsFase2] = useState({})
  const [valsFase3, setValsFase3] = useState({})
  const [valsFase4, setValsFase4] = useState({})
  const [valsFase5, setValsFase5] = useState({})
  const [desperdicio, setDesperdicio] = useState([{ item: '', ocorrido: '' }])

  useEffect(() => {
    carregarEmbalagens().then(d => { setEmbalagens(d); setLoading(false) })
  }, [])

  async function salvarTudo() {
    setSaving(true)
    try {
      const dataStr = data
      const registradoPor = nome

      // Fase 1 — desconta embalagens
      const fase1 = embalagens
        .filter(e => qtdsFase1[e.id] && parseInt(qtdsFase1[e.id]) > 0)
        .map(e => ({ embalagem_id: e.id, quantidade: parseInt(qtdsFase1[e.id]), data_producao: dataStr, registrado_por: registradoPor }))

      if (fase1.length > 0) {
        await supabase.from('producao_diaria').insert(fase1)
        for (const r of fase1) {
          const emb = embalagens.find(e => e.id === r.embalagem_id)
          const novo = Math.max(0, (emb.estoque_atual || 0) - r.quantidade)
          await supabase.from('embalagens').update({ estoque_atual: novo, atualizado_em: new Date().toISOString() }).eq('id', r.embalagem_id)
        }
      }

      // Fases internas (2, 3, 4, 5)
      const internos = []

      Object.entries(valsFase2).filter(([,v]) => v && parseFloat(v) > 0)
        .forEach(([item, quantidade]) => internos.push({ fase: 'massa', item, quantidade: parseFloat(quantidade), unidade: 'receitas', data_producao: dataStr, registrado_por: registradoPor }))

      Object.entries(valsFase3).filter(([,v]) => v && parseFloat(v) > 0)
        .forEach(([item, quantidade]) => internos.push({ fase: 'recheio', item, quantidade: parseFloat(quantidade), unidade: 'receitas', data_producao: dataStr, registrado_por: registradoPor }))

      Object.entries(valsFase4).filter(([,v]) => v && parseFloat(v) > 0)
        .forEach(([item, quantidade]) => internos.push({ fase: 'recheio_pote', item, quantidade: parseFloat(quantidade), unidade: 'receitas', data_producao: dataStr, registrado_por: registradoPor }))

      Object.entries(valsFase5).filter(([,v]) => v && parseFloat(v) > 0)
        .forEach(([item, quantidade]) => internos.push({ fase: 'cobertura', item: `Cobertura ${item}`, quantidade: parseFloat(quantidade), unidade: 'pacotes', data_producao: dataStr, registrado_por: registradoPor }))

      // Fase 6 — desperdício
      desperdicio.filter(d => d.item.trim()).forEach(d =>
        internos.push({ fase: 'desperdicio', item: d.item, observacao: d.ocorrido, quantidade: null, unidade: null, data_producao: dataStr, registrado_por: registradoPor })
      )

      if (internos.length > 0) await supabase.from('producao_interna').insert(internos)

      setSaved(true)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    }
    setSaving(false)
  }

  if (saved) return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <CheckCircle size={52} color="var(--ok)" style={{ marginBottom: 16 }} />
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Produção registrada! 🎉</div>
      <div style={{ fontSize: 14, color: 'var(--gray-600)', marginBottom: 24 }}>
        Todas as fases foram salvas e o estoque de embalagens foi atualizado automaticamente.
      </div>
      <button className="btn btn-primary" onClick={() => {
        setSaved(false); setStep(0); setNome(''); setQtdsFase1({}); setValsFase2({}); setValsFase3({}); setValsFase4({}); setValsFase5({}); setDesperdicio([{ item: '', ocorrido: '' }])
        carregarEmbalagens().then(d => setEmbalagens(d))
      }}>
        Registrar nova produção
      </button>
    </div>
  )

  // Step 0 — Identificação
  if (step === 0) return (
    <div className="card">
      <div className="card-title">📋 Registro de Produção</div>
      <div className="card-desc">Antes de começar, confirme o dia e quem está preenchendo.</div>

      <div style={{ background: 'var(--purple-pale)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 14, color: 'var(--purple-dark)' }}>
        🕐 <strong>Horário atual (São Paulo):</strong> {horario} · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 400 }}>
        <div className="form-group">
          <label className="form-label">Data da produção</label>
          <input type="date" className="form-input" value={data} onChange={e => setData(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Quem está preenchendo? *</label>
          <select className="form-input" value={nome} onChange={e => setNome(e.target.value)}>
            <option value="">Selecione seu nome...</option>
            <option>Virgínia</option>
            <option>Gabriel</option>
            <option>Larissa</option>
            <option>Teciane</option>
            <option>Marinice</option>
          </select>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setStep(1)} disabled={!nome.trim()}>
          Começar <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )

  if (loading) return <div className="loading">Carregando...</div>

  const fase = FASES[step - 1]
  const isLast = step === 6

  return (
    <div className="card">
      {/* Progresso */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {FASES.map(f => (
          <div key={f.id} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: f.id < step ? 'var(--purple)' : f.id === step ? 'var(--gold)' : 'var(--gray-200)'
          }} />
        ))}
      </div>

      <FaseHeader fase={fase} total={6} />

      {step === 1 && <Fase1 embalagens={embalagens} qtds={qtdsFase1} setQtds={setQtdsFase1} />}
      {step === 2 && <Fase2 vals={valsFase2} setVals={setValsFase2} />}
      {step === 3 && <FaseRecheios vals={valsFase3} setVals={setValsFase3} label="recheio" />}
      {step === 4 && <FaseRecheios vals={valsFase4} setVals={setValsFase4} label="recheio de potinho/potão" />}
      {step === 5 && <Fase5 vals={valsFase5} setVals={setValsFase5} />}
      {step === 6 && <Fase6 itens={desperdicio} setItens={setDesperdicio} />}

      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>
          <ChevronLeft size={16} /> Voltar
        </button>
        {!isLast ? (
          <button className="btn btn-primary" onClick={() => setStep(s => s + 1)}>
            Próxima fase <ChevronRight size={16} />
          </button>
        ) : (
          <button className="btn btn-gold" onClick={salvarTudo} disabled={saving}>
            {saving
              ? <><RefreshCw size={15} className="spin" /> Salvando tudo...</>
              : <><Save size={15} /> Finalizar e salvar produção</>
            }
          </button>
        )}
      </div>
    </div>
  )
}
