import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Printer, Save, Camera } from 'lucide-react'
import { LeitorQR, FichaEtiqueta } from './EtiquetaQR'
import { CONSERVACOES, calcularValidade, fmtDataHora, fmtValidade, fmtPrazo, numeroEtiqueta, imprimirEtiquetas, faixaConservacao } from '../lib/etiquetas'
import { estimadoLiquido, recalcularMedia } from '../lib/rendimento'

// Etiquetas de validade das preparações (massas, recheios, cremes, coberturas).
//   Imprimir  → escolhe a preparação e a conservação; a validade sai do prazo cadastrado.
//               Opcional: nº de receitas e peso total lançam o rendimento real da mesma produção
//               (preparacao_rendimento, igual à tela Rendimentos; a etiqueta guarda rendimento_id)
//   Validades → etiquetas ativas, do vencimento mais próximo; baixa como usada ou descartada
//   Ler QR    → câmera lê o QR da etiqueta e abre a baixa (o link ?etiqueta=123 também abre aqui)
//   Prazos    → prazo de validade de cada preparação por conservação + dados da empresa na etiqueta

const AVISO_SQL = 'Aplique o arquivo etiquetas_validade.sql no Supabase para usar as etiquetas.'
const CHAVE_EMPRESA = 'etiqueta_empresa'
const usuarioAtual = () => { try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || '' } catch { return '' } }
const semTabela = e => /does not exist|schema cache|column .* not found|Could not find/i.test(e?.message || '')
const TIPOS = { massa: 'Massas', recheio: 'Recheios', creme: 'Cremes', cobertura: 'Coberturas', cha: 'Chás' }
// datetime-local usa a hora local, sem fuso
const agoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

async function carregarEmpresa() {
  const { data } = await supabase.from('configuracoes').select('valor').eq('chave', CHAVE_EMPRESA).maybeSingle()
  try { return JSON.parse(data?.valor || '{}') } catch { return {} }
}

export default function Etiquetas() {
  const [aba, setAba] = useState('imprimir')
  const [preps, setPreps] = useState(null)
  const [empresa, setEmpresa] = useState({})
  const [erro, setErro] = useState('')
  const [leitor, setLeitor] = useState(false)
  const [codigo, setCodigo] = useState(null)   // etiqueta aberta (link ou número)
  const [versao, setVersao] = useState(0)      // recarrega Validades depois de uma baixa

  // Link do QR lido pela câmera do celular (?etiqueta=123): abre a etiqueta e limpa o endereço
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const n = p.get('etiqueta')
    if (!n) return
    setCodigo(n); setAba('validades')
    p.delete('etiqueta')
    window.history.replaceState(null, '', window.location.pathname + (p.toString() ? '?' + p : ''))
  }, [])

  async function carregar() {
    setErro('')
    const { data, error } = await supabase.from('preparacoes')
      .select('id, nome, tipo, validade_ambiente_dias, validade_refrigerado_dias, validade_congelado_dias, unidade_rendimento, rendimento_estimado, perda_percentual, rendimento_real_medio')
      .eq('ativo', true).order('tipo').order('nome')
    if (error) { setErro(semTabela(error) ? AVISO_SQL : error.message); setPreps([]); return }
    setPreps(data || [])
    setEmpresa(await carregarEmpresa())
  }
  useEffect(() => { carregar() }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['imprimir', '🏷️ Imprimir'], ['validades', '⏳ Validades'], ['prazos', '⚙️ Prazos']].map(([id, l]) => (
          <button key={id} className={`btn btn-sm ${aba === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAba(id)}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setLeitor(true)}><Camera size={13} /> Ler QR</button>
      </div>
      {leitor && <LeitorQR onFechar={() => setLeitor(false)} onLido={t => { setLeitor(false); setCodigo(t) }} />}
      {codigo && <FichaEtiqueta codigo={codigo} onFechar={() => setCodigo(null)} onBaixa={() => setVersao(v => v + 1)}
        onLerOutra={() => { setCodigo(null); setLeitor(true) }} />}
      {erro && <div className="alert-banner danger">{erro}</div>}
      {preps === null ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : (
        <>
          {aba === 'imprimir' && <Imprimir preps={preps} empresa={empresa} irPrazos={() => setAba('prazos')} />}
          {aba === 'validades' && <Validades key={versao} empresa={empresa} onAbrir={n => setCodigo(String(n))} />}
          {aba === 'prazos' && <Prazos preps={preps} empresa={empresa} onSalvo={carregar} />}
        </>
      )}
    </div>
  )
}

// ── Imprimir ──────────────────────────────────────────────────────────────────
function Imprimir({ preps, empresa, irPrazos }) {
  const [prepId, setPrepId] = useState('')
  const [cons, setCons] = useState('')
  const [qtd, setQtd] = useState(1)
  const [manipulado, setManipulado] = useState(agoraLocal())
  const [responsavel, setResponsavel] = useState(usuarioAtual())
  const [obs, setObs] = useState('')
  const [msg, setMsg] = useState(null)
  const [imprimindo, setImprimindo] = useState(false)
  const [receitas, setReceitas] = useState('')        // rendimento desta produção (opcional)
  const [pesoTotal, setPesoTotal] = useState('')
  const [jaLancado, setJaLancado] = useState([])      // rendimentos já lançados da preparação no mesmo dia

  const comPrazo = preps.filter(p => Object.values(CONSERVACOES).some(c => p[c.campo]))
  const prep = preps.find(p => p.id === prepId)
  const opcoes = prep ? Object.entries(CONSERVACOES).filter(([, c]) => prep[c.campo]) : []
  useEffect(() => { setCons(opcoes.length === 1 ? opcoes[0][0] : opcoes.some(([k]) => k === cons) ? cons : '') }, [prepId])
  const dias = prep && cons ? prep[CONSERVACOES[cons].campo] : null
  const validade = dias ? calcularValidade(manipulado, dias) : null
  const diaProducao = manipulado.slice(0, 10)
  useEffect(() => {
    setJaLancado([])
    if (!prepId || !diaProducao) return
    supabase.from('preparacao_rendimento').select('num_receitas, rendimento_total').eq('preparacao_id', prepId).eq('data_producao', diaProducao)
      .then(({ data }) => setJaLancado(data || []))
  }, [prepId, diaProducao])
  const numRec = parseFloat(String(receitas).replace(',', '.')) || 0
  const peso = parseFloat(String(pesoTotal).replace(',', '.')) || 0
  const lancaRendimento = numRec > 0 && peso > 0
  const rendMeio = (receitas !== '' || pesoTotal !== '') && !lancaRendimento   // só um dos dois preenchido
  const porReceita = lancaRendimento ? peso / numRec : null
  const estLiq = prep ? estimadoLiquido(prep) : 0
  const variacao = porReceita && estLiq ? (porReceita - estLiq) / estLiq * 100 : null

  const previa = prep && cons ? { nome: prep.nome, conservacao: cons, manipulado_em: new Date(manipulado), validade, responsavel, observacao: obs, numero: 0 } : null

  async function imprimir() {
    const n = Math.max(1, Math.min(50, parseInt(qtd) || 1))
    if (rendMeio) { setMsg({ tipo: 'danger', txt: 'Para lançar o rendimento, preencha o nº de receitas e o peso total (ou deixe os dois em branco).' }); return }
    if (lancaRendimento && jaLancado.length && !confirm(`Já há ${jaLancado.length} rendimento(s) de ${prep.nome} lançado(s) neste dia. É outra produção? (OK lança mais um)`)) return
    setImprimindo(true); setMsg(null)

    // 1) rendimento da produção (mesmo registro da tela Rendimentos)
    let rend = null
    if (lancaRendimento) {
      const { data: r, error: e1 } = await supabase.from('preparacao_rendimento').insert({
        preparacao_id: prep.id, num_receitas: numRec, rendimento_total: peso, data_producao: diaProducao,
        responsavel: responsavel.trim() || null, observacao: ['Lançado na etiqueta', obs.trim()].filter(Boolean).join(' · '),
      }).select('id').single()
      if (e1) { setImprimindo(false); setMsg({ tipo: 'danger', txt: 'Rendimento não lançado: ' + e1.message }); return }
      rend = r.id
    }

    // 2) etiquetas
    const linhas = Array.from({ length: n }, () => ({
      preparacao_id: prep.id, nome: prep.nome, conservacao: cons,
      manipulado_em: new Date(manipulado).toISOString(), validade: validade.toISOString(),
      responsavel: responsavel.trim() || null, observacao: obs.trim() || null,
      ...(rend ? { rendimento_id: rend } : {}),
    }))
    let { data, error } = await supabase.from('etiquetas').insert(linhas).select('*').order('numero')
    if (error && rend && semTabela(error)) {
      // etiquetas_rendimento.sql ainda não aplicado: imprime sem o vínculo
      ({ data, error } = await supabase.from('etiquetas').insert(linhas.map(({ rendimento_id, ...l }) => l)).select('*').order('numero'))
    }
    if (error) {
      if (rend) await supabase.from('preparacao_rendimento').delete().eq('id', rend)   // nada pela metade
      setImprimindo(false)
      setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message }); return
    }
    if (rend) await recalcularMedia(prep.id)
    setImprimindo(false)
    await imprimirEtiquetas(data, empresa)
    const txtRend = rend ? ` Rendimento lançado: ${fmtNum(peso)} ${prep.unidade_rendimento || ''} em ${fmtNum(numRec)} receita${numRec === 1 ? '' : 's'}.` : ''
    if (rend) setJaLancado(j => [...j, { num_receitas: numRec, rendimento_total: peso }])
    setReceitas(''); setPesoTotal('')
    setMsg({ tipo: 'ok', txt: `${n} etiqueta${n > 1 ? 's' : ''} de ${prep.nome} (${numeroEtiqueta(data[0].numero)}${n > 1 ? ' a ' + numeroEtiqueta(data[n - 1].numero) : ''}) enviada${n > 1 ? 's' : ''} para impressão.${txtRend}` })
    setQtd(1); setObs('')
  }

  if (!comPrazo.length) return (
    <div className="alert-banner info">
      Nenhuma preparação com prazo de validade cadastrado ainda. Cadastre os prazos na aba{' '}
      <button className="btn btn-ghost btn-sm" onClick={irPrazos}>⚙️ Prazos</button>
    </div>
  )

  const grupos = [...new Set(comPrazo.map(p => p.tipo))]
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div className="card card-pad" style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Etiqueta de validade</div>
        <label style={{ fontSize: 12, fontWeight: 700 }}>Preparação
          <select className="form-input" value={prepId} onChange={e => setPrepId(e.target.value)} style={{ marginTop: 4 }}>
            <option value="">Escolha…</option>
            {grupos.map(t => (
              <optgroup key={t} label={TIPOS[t] || t}>
                {comPrazo.filter(p => p.tipo === t).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {prep && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Conservação</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {opcoes.map(([k, c]) => (
                <button key={k} className={`btn btn-sm ${cons === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCons(k)}>
                  {c.nome} · {fmtPrazo(prep[c.campo])}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700, flex: '1 1 180px' }}>Manipulado em
            <input type="datetime-local" className="form-input" value={manipulado} onChange={e => setManipulado(e.target.value)} style={{ marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, width: 110 }}>Etiquetas
            <input type="number" min={1} max={50} className="form-input" value={qtd} onChange={e => setQtd(e.target.value)} style={{ marginTop: 4 }} />
          </label>
        </div>
        <label style={{ fontSize: 12, fontWeight: 700 }}>Responsável
          <input className="form-input" value={responsavel} onChange={e => setResponsavel(e.target.value)} style={{ marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>Observação (opcional)
          <input className="form-input" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex.: lote 2, 1,5 kg" style={{ marginTop: 4 }} />
        </label>
        {prep && (
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>Rendimento desta produção <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(opcional)</span></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, fontWeight: 700, width: 120 }}>Nº de receitas
                <input type="number" min={0.5} step={0.5} inputMode="decimal" className="form-input" value={receitas} onChange={e => setReceitas(e.target.value)} style={{ marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 700, flex: '1 1 140px' }}>Peso total ({prep.unidade_rendimento || 'g'})
                <input type="number" min={0} step={0.1} inputMode="decimal" className="form-input" value={pesoTotal} onChange={e => setPesoTotal(e.target.value)}
                  placeholder={estLiq ? `ex.: ${fmtNum(estLiq * (numRec || 1), 0)}` : ''} style={{ marginTop: 4 }} />
              </label>
            </div>
            {porReceita !== null && (
              <div style={{ fontSize: 12 }}>
                {fmtNum(porReceita)} {prep.unidade_rendimento} por receita
                {variacao !== null && <b style={{ marginLeft: 6, color: Math.abs(variacao) <= 5 ? 'var(--ok)' : Math.abs(variacao) <= 15 ? 'var(--warning)' : 'var(--danger)' }}>
                  {variacao > 0 ? '+' : ''}{fmtNum(variacao)}% vs. estimado líquido ({fmtNum(estLiq)})</b>}
              </div>
            )}
            {jaLancado.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--warning)' }}>
                Já lançado neste dia: {jaLancado.map(r => `${fmtNum(r.rendimento_total)} ${prep.unidade_rendimento || ''} em ${fmtNum(r.num_receitas)} rec.`).join(' · ')}.
                Só preencha se for outra produção.
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>Entra na média real da preparação (tela Rendimentos), que alimenta o custo.</div>
          </div>
        )}
        <button className="btn btn-primary" onClick={imprimir} disabled={!previa || imprimindo}>
          {imprimindo ? <><RefreshCw size={14} className="spin" /> Gerando…</> : <><Printer size={14} /> Imprimir {Math.max(1, parseInt(qtd) || 1)} etiqueta{(parseInt(qtd) || 1) > 1 ? 's' : ''}</>}
        </button>
        {msg && <div className={`alert-banner ${msg.tipo}`}>{msg.txt}</div>}
        <div style={{ fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.5 }}>
          Na Zebra ZD220, com o rolo de 60×60 mm, o tamanho do papel nas preferências da impressora precisa ser 60×60 mm.
          Na janela de impressão, escolha a Zebra e escala 100% (tamanho real).
        </div>
      </div>
      <div className="card card-pad" style={{ flex: '0 0 auto' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', marginBottom: 8 }}>Prévia</div>
        {previa ? <PreviaEtiqueta e={previa} empresa={empresa} /> : (
          <div style={{ width: 240, height: 240, border: '1px dashed var(--gray-300)', borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--gray-400)' }}>
            Escolha a preparação
          </div>
        )}
      </div>
    </div>
  )
}

const fmtNum = (n, d = 1) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d })

// Prévia em tela (escala 4 px por mm), no mesmo arranjo do PDF
function PreviaEtiqueta({ e, empresa }) {
  return (
    <div style={{ width: 240, height: 240, border: '1px solid var(--gray-300)', borderRadius: 6, padding: 12, boxSizing: 'border-box', background: '#fff', color: '#000', display: 'flex', flexDirection: 'column', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.15, maxHeight: 36, overflow: 'hidden' }}>{e.nome}</div>
      <div style={{ background: '#000', color: '#fff', fontWeight: 700, fontSize: 11, textAlign: 'center', padding: '3px 0', margin: '6px 0' }}>{faixaConservacao(e.conservacao)}</div>
      <div style={{ fontSize: 9 }}>MANIPULAÇÃO</div>
      <div style={{ fontWeight: 800, fontSize: 13 }}>{fmtDataHora(e.manipulado_em)}</div>
      <div style={{ fontSize: 9, marginTop: 4 }}>VALIDADE</div>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{fmtValidade(e.validade)}</div>
      {e.responsavel && <div style={{ fontSize: 10, marginTop: 4 }}>Resp.: {e.responsavel}</div>}
      {e.observacao && <div style={{ fontSize: 10 }}>{e.observacao}</div>}
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: '1px solid #000', paddingTop: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 6 }}>
        <div style={{ fontSize: 7, lineHeight: 1.3 }}>
          {[empresa?.nome, empresa?.cnpj && `CNPJ ${empresa.cnpj}`].filter(Boolean).join(' · ')}
          {empresa?.endereco && <div>{empresa.endereco}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ width: 52, height: 52, border: '1px dashed #999', display: 'grid', placeItems: 'center', fontSize: 9, color: '#999', marginLeft: 'auto' }}>QR</div>
          <b style={{ fontSize: 12 }}>{e.numero ? numeroEtiqueta(e.numero) : '#000000'}</b>
        </div>
      </div>
    </div>
  )
}

// ── Validades ─────────────────────────────────────────────────────────────────
function Validades({ empresa, onAbrir }) {
  const [lista, setLista] = useState(null)
  const [busca, setBusca] = useState('')
  const [msg, setMsg] = useState(null)

  async function carregar() {
    const { data, error } = await supabase.from('etiquetas').select('*').eq('status', 'ativa').order('validade')
    if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message }); setLista([]); return }
    setLista(data || [])
  }
  useEffect(() => { carregar() }, [])

  const grupos = useMemo(() => {
    if (!lista) return []
    const q = busca.trim().toLowerCase().replace('#', '')
    const f = lista.filter(e => !q || e.nome.toLowerCase().includes(q) || String(e.numero).includes(q.replace(/^0+/, '')))
    const agora = new Date(), fimHoje = new Date(agora); fimHoje.setHours(23, 59, 59, 999)
    const fimAmanha = new Date(fimHoje); fimAmanha.setDate(fimAmanha.getDate() + 1)
    return [
      { id: 'vencidas', titulo: 'Vencidas', cor: 'var(--danger)', itens: f.filter(e => new Date(e.validade) < agora) },
      { id: 'hoje', titulo: 'Vencem hoje', cor: 'var(--warning)', itens: f.filter(e => new Date(e.validade) >= agora && new Date(e.validade) <= fimHoje) },
      { id: 'amanha', titulo: 'Vencem amanhã', cor: 'var(--gold)', itens: f.filter(e => new Date(e.validade) > fimHoje && new Date(e.validade) <= fimAmanha) },
      { id: 'depois', titulo: 'Dentro da validade', cor: 'var(--ok)', itens: f.filter(e => new Date(e.validade) > fimAmanha) },
    ]
  }, [lista, busca])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Validades das preparações</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Etiquetas impressas e ainda não baixadas. Ao terminar um pote, leia o QR da etiqueta (botão Ler QR) e dê baixa como usada; se for para o lixo, como descartada.</div>
        </div>
        <input className="form-input" placeholder="Buscar nome ou nº da etiqueta" value={busca} onChange={e => setBusca(e.target.value)} style={{ width: 230 }} />
        <button className="btn btn-ghost btn-sm" onClick={carregar}><RefreshCw size={13} /></button>
      </div>
      {msg && <div className={`alert-banner ${msg.tipo}`}>{msg.txt}</div>}
      {lista === null ? <div className="loading"><RefreshCw size={14} className="spin" /></div> : !lista.length ? (
        <div className="card card-pad" style={{ color: 'var(--gray-500)', fontSize: 13 }}>Nenhuma etiqueta ativa.</div>
      ) : grupos.filter(g => g.itens.length).map(g => (
        <div key={g.id} className="card">
          <div style={{ padding: '8px 14px', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', color: g.cor, borderBottom: '1px solid var(--gray-200)' }}>
            {g.titulo} ({g.itens.length})
          </div>
          {g.itens.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid var(--gray-100)', flexWrap: 'wrap', fontSize: 13 }}>
              <b style={{ fontFamily: 'monospace', width: 70 }}>{numeroEtiqueta(e.numero)}</b>
              <div style={{ flex: '1 1 200px' }}>
                <div style={{ fontWeight: 700 }}>{e.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
                  {CONSERVACOES[e.conservacao]?.nome} · manipulado {fmtDataHora(e.manipulado_em)}{e.responsavel ? ` · ${e.responsavel}` : ''}
                </div>
              </div>
              <div style={{ fontWeight: 800, color: g.cor, minWidth: 140 }}>{fmtValidade(e.validade)}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => imprimirEtiquetas([e], empresa)} title="Reimprimir"><Printer size={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => onAbrir(e.numero)}>Dar baixa</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Prazos (configuração inicial de cada preparação) ──────────────────────────
function Prazos({ preps, empresa, onSalvo }) {
  const [vals, setVals] = useState({})       // id → { campo: texto }
  const [emp, setEmp] = useState(empresa)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => setEmp(empresa), [empresa])

  const valor = (p, campo) => vals[p.id]?.[campo] ?? (p[campo] != null ? String(p[campo]).replace('.', ',') : '')
  const mudar = (id, campo, v) => setVals(s => ({ ...s, [id]: { ...s[id], [campo]: v } }))
  const editados = Object.keys(vals)

  async function salvar() {
    setSalvando(true); setMsg(null)
    for (const id of editados) {
      const upd = {}
      for (const [campo, txt] of Object.entries(vals[id])) {
        const v = String(txt).trim() === '' ? null : parseFloat(String(txt).replace(',', '.'))
        if (v !== null && !(v > 0)) { setMsg({ tipo: 'danger', txt: 'Prazo precisa ser maior que zero (ou vazio).' }); setSalvando(false); return }
        upd[campo] = v
      }
      const { error } = await supabase.from('preparacoes').update(upd).eq('id', id)
      if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message }); setSalvando(false); return }
    }
    const { error } = await supabase.from('configuracoes').upsert({
      chave: CHAVE_EMPRESA, valor: JSON.stringify({ nome: emp.nome || '', cnpj: emp.cnpj || '', endereco: emp.endereco || '' }),
      descricao: 'Dados da empresa impressos nas etiquetas de validade. Produção › Etiquetas › Prazos.',
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'chave' })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'danger', txt: error.message }); return }
    setVals({}); setMsg({ tipo: 'ok', txt: 'Prazos salvos.' }); onSalvo?.()
  }

  const th = { padding: '8px 10px', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700, textAlign: 'center' }
  return (
    <div className="card">
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-200)' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Prazo de validade de cada preparação</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            Em dias, por forma de conservação (use vírgula para frações: 0,5 = 12 horas). Deixe vazio quando a preparação não é guardada assim.
          </div>
        </div>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
          {salvando ? <RefreshCw size={14} className="spin" /> : <Save size={14} />} Salvar
        </button>
      </div>
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ margin: 12 }}>{msg.txt}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)' }}>
              <th style={{ ...th, textAlign: 'left' }}>Preparação</th>
              {Object.values(CONSERVACOES).map(c => <th key={c.campo} style={th}>{c.nome}<div style={{ fontWeight: 400 }}>{c.faixa || 'ambiente'}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {preps.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--gray-100)', background: vals[p.id] ? '#fffbf0' : undefined }}>
                <td style={{ padding: '6px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{p.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{TIPOS[p.tipo] || p.tipo}</div>
                </td>
                {Object.values(CONSERVACOES).map(c => (
                  <td key={c.campo} style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <input className="form-input" inputMode="decimal" value={valor(p, c.campo)} onChange={e => mudar(p.id, c.campo, e.target.value)}
                      placeholder="—" style={{ width: 70, textAlign: 'center', padding: '4px 6px' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--gray-200)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>Dados da empresa na etiqueta</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="form-input" placeholder="Nome" value={emp.nome || ''} onChange={e => setEmp(s => ({ ...s, nome: e.target.value }))} style={{ flex: '1 1 160px' }} />
          <input className="form-input" placeholder="CNPJ" value={emp.cnpj || ''} onChange={e => setEmp(s => ({ ...s, cnpj: e.target.value }))} style={{ flex: '1 1 160px' }} />
          <input className="form-input" placeholder="Endereço" value={emp.endereco || ''} onChange={e => setEmp(s => ({ ...s, endereco: e.target.value }))} style={{ flex: '2 1 260px' }} />
        </div>
      </div>
    </div>
  )
}
