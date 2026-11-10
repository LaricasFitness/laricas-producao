import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Upload, Save, ChevronDown, ChevronRight, X, Lock, LockOpen, Camera, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  LINHAS, LINHAS_ESCOLHA, RECEITAS, ESTRUTURA, AMBIGUAS,
  resolverLinha, lerContasCompetencia, lerBalancete, montarDRE, calcularEstrutura, conferir, mesVencimento,
  PLATAFORMAS, siglaUnidade, rotuloCanal, custoCanal, marketingCanal, liquidoCanal, LINHAS_CANAL,
} from '../lib/dre'
import { arquivoParaEnvio } from '../lib/arquivoEnvio'
import { lerPlanilha99 } from '../lib/planilha99'
import { lerPlanilhaKeeta } from '../lib/planilhaKeeta'

// Financeiro: DRE por competência e por caixa a partir das exportações do Bling.
// Regras e desenho da DRE em src/lib/dre.js.

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtPct = n => `${fmt(n * 100, 1)}%`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`
const AVISO_SQL = 'As tabelas da DRE ainda não existem no banco: aplique o arquivo financeiro_dre.sql no Supabase.'
const semTabela = e => /does not exist|relation .* not exist|42P01|schema cache/i.test(e?.message || '') || e?.code === '42P01'

function usuarioNome() {
  try { return JSON.parse(sessionStorage.getItem('usuario'))?.nome || null } catch { return null }
}

// Supabase devolve no máximo 1000 linhas por consulta
async function buscarTudo(montar) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

export default function FinanceiroHub({ sub: subMenu, onSub }) {
  const [subLocal, setSubLocal] = useState('dre')
  const sub = subMenu ?? subLocal
  const setSub = onSub ?? setSubLocal
  return (
    <>
      <div className="tabs hub-tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${sub === 'dre' ? ' active' : ''}`} onClick={() => setSub('dre')}>📋 DRE</button>
        <button className={`tab${sub === 'importar' ? ' active' : ''}`} onClick={() => setSub('importar')}>⬆️ Importar e classificar</button>
      </div>
      {sub === 'dre' && <TelaDRE irImportar={() => setSub('importar')} />}
      {sub === 'importar' && <TelaImportar />}
    </>
  )
}

// ── Dados ─────────────────────────────────────────────────────────────────────
async function carregarAno(ano) {
  const ini = `${ano}-01-01`, fim = `${ano}-12-31`
  const [contas, caixa, receitas, mapaDB, cmvRows] = await Promise.all([
    buscarTudo(() => supabase.from('dre_contas_competencia').select('*')
      .gte('competencia', `${ano - 1}-12-01`).lte('competencia', fim).order('competencia')),
    buscarTudo(() => supabase.from('dre_caixa').select('mes, tipo, categoria, valor').like('mes', `${ano}-%`)),
    buscarTudo(() => supabase.from('dre_receita_competencia').select('mes, linha, valor').like('mes', `${ano}-%`)),
    buscarTudo(() => supabase.from('dre_mapa').select('origem, categoria, nome, linha')),
    buscarTudo(() => supabase.from('fechamento_cmv').select('mes, cmv_valor').like('mes', `${ano}-%`)),
  ])
  const cmvSistema = {}
  for (const r of cmvRows) cmvSistema[r.mes] = (cmvSistema[r.mes] || 0) + (Number(r.cmv_valor) || 0)
  // dre_mes (conferência e cadeado) existe a partir do financeiro_dre_2.sql
  let mesInfo = [], semTabelaMes = false
  try { mesInfo = await buscarTudo(() => supabase.from('dre_mes').select('*').like('mes', `${ano}-%`)) }
  catch (e) { if (semTabela(e)) semTabelaMes = true; else throw e }
  // dre_canal_competencia (faturamento das plataformas) existe a partir do financeiro_dre_3.sql
  let canais = []
  try { canais = await buscarTudo(() => supabase.from('dre_canal_competencia').select('*').gte('mes', `${ano - 1}-12`).lte('mes', `${ano}-12`)) }
  catch (e) { if (!semTabela(e)) throw e }
  return { contas, caixa, receitas, canais, mapaDB, cmvSistema, mesInfo, semTabelaMes, ini }
}

// Meses fechados usam os valores guardados no cadeado
function aplicarFechados(vivo, dados, visao) {
  const porMes = { ...vivo.porMes }, extras = { ...vivo.extras }
  for (const r of dados.mesInfo) {
    if (r.visao !== visao || !r.fechado_em || !r.valores || !(r.mes in porMes)) continue
    porMes[r.mes] = r.valores
    extras[r.mes] = { ...(r.extras || {}), fechado: true, temCaixa: true }
  }
  return { ...vivo, porMes, extras }
}

// ── DRE ───────────────────────────────────────────────────────────────────────
function TelaDRE({ irImportar }) {
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [visao, setVisao] = useState('competencia')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [abertos, setAbertos] = useState(() => new Set(ESTRUTURA.filter(e => e.tipo === 'grupo').map(e => e.id)))
  const [detalhe, setDetalhe] = useState(null) // { mes, linha }

  async function carregar() {
    setCarregando(true); setErro('')
    try { setDados(await carregarAno(ano)) }
    catch (e) { setErro(semTabela(e) ? AVISO_SQL : 'Erro ao carregar: ' + (e.message || e)); setDados(null) }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [ano])

  const todosMeses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`)
  const vivo = useMemo(() => dados && montarDRE({ visao, meses: todosMeses, ...dados }), [dados, visao, ano])
  const dre = useMemo(() => vivo && aplicarFechados(vivo, dados, visao), [vivo])

  // Meses com dado na visão escolhida
  const meses = !dre ? [] : todosMeses.filter(m => visao === 'competencia'
    ? dados.contas.some(c => c.competencia.startsWith(m)) || dados.receitas.some(r => r.mes === m) || dados.canais.some(r => r.mes === m) || dre.extras[m].fechado
    : dre.extras[m].temCaixa)

  const estrutura = Object.fromEntries(meses.map(m => [m, calcularEstrutura(dre.porMes[m])]))
  const totalLinha = l => meses.reduce((s, m) => s + (dre.porMes[m][l] || 0), 0)
  const totalEst = id => meses.reduce((s, m) => s + estrutura[m][id], 0)
  const receitaTotal = totalEst('receita')
  const semReceita = visao === 'competencia' ? meses.filter(m => !dre.extras[m].temReceita) : []
  const cmvCompras = visao === 'competencia' ? meses.filter(m => dre.extras[m].cmvFonte === 'compras') : []

  // Lojas das plataformas dentro da linha (iFood BV, 99 Food BK…) e o resto da linha em "demais"
  const sublinhas = l => {
    if (!LINHAS_CANAL[l]) return null
    const rotulos = [...new Set(meses.flatMap(m => Object.keys(dre.extras[m].sub?.[l] || {})))]
    if (!rotulos.length) return null
    const lin = rotulos.map(r => {
      const porMes = Object.fromEntries(meses.map(m => [m, dre.extras[m].sub?.[l]?.[r] || 0]))
      return { rotulo: r, porMes, total: meses.reduce((s, m) => s + porMes[m], 0) }
    }).sort((a, b) => b.total - a.total)
    const resto = Object.fromEntries(meses.map(m => [m, (dre.porMes[m][l] || 0) - lin.reduce((s, x) => s + x.porMes[m], 0)]))
    const totalResto = meses.reduce((s, m) => s + resto[m], 0)
    if (meses.some(m => Math.abs(resto[m]) >= 0.005)) lin.push({
      rotulo: l === 'rec_delivery' ? 'Digitado (fora das plataformas)' : l === 'rec_site' ? 'Digitado (fora da Shopify)' : 'Demais lançamentos (Bling)', porMes: resto, total: totalResto,
    })
    return lin
  }

  const alternar = id => setAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const celula = (v, extra) => (
    <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: v < 0 ? 'var(--gray-700)' : 'var(--gray-800)', ...extra }}>
      {Math.abs(v) < 0.005 ? <span style={{ color: 'var(--gray-300)' }}>—</span> : fmt(v)}
    </td>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['competencia', 'Competência'], ['caixa', 'Caixa']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${visao === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setVisao(v)}>{l}</button>
          ))}
        </div>
        <select className="form-input" value={ano} onChange={e => setAno(+e.target.value)} style={{ width: 100, fontSize: 13 }}>
          {[anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map(a => <option key={a}>{a}</option>)}
        </select>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--gray-400)', minWidth: 200 }}>
          {visao === 'competencia'
            ? 'Despesas pela data de competência (Bling); faturamento das plataformas e receita digitada; CMV do fechamento do sistema.'
            : 'Entradas e saídas pagas no mês, pelo Balancete do Bling.'}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={carregar} title="Recarregar"><RefreshCw size={13} /></button>
      </div>

      {erro && <div className="alert-banner danger">{erro}</div>}
      {carregando && <div className="loading"><RefreshCw size={14} className="spin" /></div>}

      {!carregando && dre && !meses.length && (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--gray-500)' }}>
          Nenhum dado de {ano} na visão de {visao === 'competencia' ? 'competência' : 'caixa'}.{' '}
          <button className="btn btn-primary btn-sm" onClick={irImportar}><Upload size={13} /> Importar do Bling</button>
        </div>
      )}

      {!carregando && dre && meses.length > 0 && (
        <>
          {(semReceita.length > 0 || dre.pendentes.length > 0 || cmvCompras.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {semReceita.length > 0 && (
                <div className="alert-banner warning">
                  Receita por competência não digitada em: <b>{semReceita.map(rotuloMes).join(', ')}</b>.
                  <button className="btn btn-ghost btn-xs" onClick={irImportar}>Digitar receita</button>
                </div>
              )}
              {dre.pendentes.length > 0 && (
                <div className="alert-banner warning">
                  {dre.pendentes.length} categoria(s) sem linha na DRE (R$ {fmt(dre.pendentes.reduce((s, p) => s + p.valor, 0))} em "sem classificação").
                  <button className="btn btn-ghost btn-xs" onClick={irImportar}>Classificar</button>
                </div>
              )}
              {cmvCompras.length > 0 && (
                <div className="alert-banner info">
                  CMV de {cmvCompras.map(rotuloMes).join(', ')} pelas compras lançadas no Bling: o fechamento de CMV do sistema só existe a partir de set/26.
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)', borderBottom: '2px solid var(--gray-200)' }}>
                  <th style={{ padding: '8px 14px', textAlign: 'left', minWidth: 260 }}>{visao === 'competencia' ? 'Competência' : 'Caixa'} {ano}</th>
                  {meses.map(m => (
                    <th key={m} style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }} title={dre.extras[m].fechado ? 'Mês fechado (cadeado)' : undefined}>
                      {dre.extras[m].fechado && <Lock size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--ok)' }} />}{rotuloMes(m)}
                    </th>
                  ))}
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '8px 14px 8px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>% receita</th>
                </tr>
              </thead>
              <tbody>
                {ESTRUTURA.map(e => {
                  const total = totalEst(e.id)
                  const pct = receitaTotal ? fmtPct(total / receitaTotal) : '—'
                  if (e.tipo === 'total') return (
                    <tr key={e.id} style={{ background: e.destaque ? 'var(--purple-pale)' : 'var(--gray-50)', borderTop: '1px solid var(--gray-200)', borderBottom: '1px solid var(--gray-200)' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 800 }}>{e.nome}</td>
                      {meses.map(m => celula(estrutura[m][e.id], { fontWeight: 800 }))}
                      {celula(total, { fontWeight: 800 })}
                      <td style={{ padding: '6px 14px 6px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--gray-500)' }}>{pct}</td>
                    </tr>
                  )
                  const aberto = abertos.has(e.id)
                  const linhas = e.linhas.filter(l => totalLinha(l) > 0.005 || (l === 'cmv' && visao === 'competencia'))
                  return [
                    <tr key={e.id} style={{ borderTop: '1px solid var(--gray-100)', cursor: 'pointer' }} onClick={() => alternar(e.id)}>
                      <td style={{ padding: '7px 14px', fontWeight: 700 }}>
                        {aberto ? <ChevronDown size={13} style={{ verticalAlign: -2 }} /> : <ChevronRight size={13} style={{ verticalAlign: -2 }} />} {e.nome}
                      </td>
                      {meses.map(m => celula(estrutura[m][e.id], { fontWeight: 700 }))}
                      {celula(total, { fontWeight: 700 })}
                      <td style={{ padding: '6px 14px 6px 10px', textAlign: 'right', color: 'var(--gray-500)' }}>{pct}</td>
                    </tr>,
                    ...(aberto ? linhas.flatMap(l => {
                      const L = LINHAS[l]
                      const row = (
                        <tr key={e.id + l} style={{ borderTop: '1px solid var(--gray-100)' }}>
                          <td style={{ padding: '5px 14px 5px 34px', color: L.alerta ? 'var(--danger)' : 'var(--gray-600)' }}>{L.nome}</td>
                          {meses.map(m => {
                            const v = (L.sinal || 1) * (dre.porMes[m][l] || 0)
                            const marca = l === 'cmv' && visao === 'competencia' && dre.extras[m].cmvFonte === 'compras'
                            return (
                              <td key={m} onClick={() => setDetalhe({ mes: m, linha: l })} title="Ver lançamentos"
                                style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap', cursor: 'pointer', color: L.alerta ? 'var(--danger)' : 'var(--gray-600)' }}>
                                {Math.abs(v) < 0.005 ? <span style={{ color: 'var(--gray-300)' }}>—</span> : fmt(v)}
                                {marca && Math.abs(v) >= 0.005 && <sup style={{ color: 'var(--warning)' }}>*</sup>}
                              </td>
                            )
                          })}
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--gray-600)' }}>{fmt((L.sinal || 1) * totalLinha(l))}</td>
                          <td style={{ padding: '5px 14px 5px 10px', textAlign: 'right', color: 'var(--gray-400)' }}>
                            {receitaTotal ? fmtPct((L.sinal || 1) * totalLinha(l) / receitaTotal) : '—'}
                          </td>
                        </tr>
                      )
                      const subs = visao === 'competencia' ? sublinhas(l) : null
                      if (subs) return [row, ...subs.map(sb => (
                        <tr key={e.id + l + sb.rotulo}>
                          <td style={{ padding: '2px 14px 4px 48px', fontSize: 12, color: 'var(--gray-500)' }}>{sb.rotulo}</td>
                          {meses.map(m => (
                            <td key={m} style={{ padding: '2px 10px 4px', textAlign: 'right', fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                              {Math.abs(sb.porMes[m]) < 0.005 ? <span style={{ color: 'var(--gray-300)' }}>—</span> : fmt((L.sinal || 1) * sb.porMes[m])}
                            </td>
                          ))}
                          <td style={{ padding: '2px 10px 4px', textAlign: 'right', fontSize: 12, color: 'var(--gray-500)' }}>{fmt((L.sinal || 1) * sb.total)}</td>
                          <td style={{ padding: '2px 14px 4px 10px', textAlign: 'right', fontSize: 11, color: 'var(--gray-400)' }}>
                            {receitaTotal ? fmtPct((L.sinal || 1) * sb.total / receitaTotal) : '—'}
                          </td>
                        </tr>
                      ))]
                      if (l !== 'cmv' || visao !== 'competencia') return [row]
                      return [row, (
                        <tr key={e.id + l + 'memo'}>
                          <td style={{ padding: '2px 14px 6px 48px', fontSize: 11, color: 'var(--gray-400)' }}>
                            compras de MP e embalagem lançadas no Bling (comparação)
                          </td>
                          {meses.map(m => (
                            <td key={m} style={{ padding: '2px 10px 6px', textAlign: 'right', fontSize: 11, color: 'var(--gray-400)' }}>
                              {dre.extras[m].cmvCompras ? fmt(dre.extras[m].cmvCompras) : '—'}
                            </td>
                          ))}
                          <td style={{ padding: '2px 10px 6px', textAlign: 'right', fontSize: 11, color: 'var(--gray-400)' }}>
                            {fmt(meses.reduce((s, m) => s + (dre.extras[m].cmvCompras || 0), 0))}
                          </td>
                          <td />
                        </tr>
                      )]
                    }) : []),
                  ]
                })}
              </tbody>
            </table>
            <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--gray-400)', borderTop: '1px solid var(--gray-100)' }}>
              Clique numa linha para abrir ou fechar o grupo e num valor para ver os lançamentos.
              {visao === 'competencia' && ' * CMV pelas compras do mês (sem fechamento de CMV no sistema).'}
            </div>
          </div>
        </>
      )}

      {!carregando && dre && meses.length > 0 && (
        <Conferencia visao={visao} meses={meses} dados={dados} dre={vivo} onMudou={carregar} />
      )}

      {detalhe && dados && (
        <ModalDetalhe {...detalhe} visao={visao} dados={dados} extras={dre.extras[detalhe.mes]} onClose={() => setDetalhe(null)} />
      )}
    </div>
  )
}

function ModalDetalhe({ mes, linha, visao, dados, extras, onClose }) {
  const L = LINHAS[linha]
  let itens = []
  if (visao === 'competencia') {
    itens = dados.contas.filter(c => c.competencia.startsWith(mes)).filter(c => {
      const l = resolverLinha('competencia', c.categoria, c.nome, dados.mapaDB)
      return linha === 'nao_class' ? !l : l === linha
    }).map(c => ({ a: c.nome, b: c.categoria, c: c.observacoes, valor: Number(c.valor), d: c.situacao }))
    if (RECEITAS.includes(linha)) itens = dados.receitas.filter(r => r.mes === mes && r.linha === linha)
      .map(r => ({ a: 'Digitado na tela', b: '', c: '', valor: Number(r.valor) }))
    if (LINHAS_CANAL[linha]) itens = [...itens, ...dados.canais.filter(r => r.mes === mes).map(r => ({
      a: rotuloCanal(r), b: 'Faturamento da plataforma',
      c: linha === 'dv_comercial' ? `taxas ${fmt(r.taxas)} + serviços ${fmt(r.servicos)} − ajustes ${fmt(r.ajustes)}` : '',
      valor: LINHAS_CANAL[linha](r), d: rotuloOrigem(r.origem),
    })).filter(i => Math.abs(i.valor) >= 0.005)]
  } else {
    itens = dados.caixa.filter(c => c.mes === mes && c.tipo !== 'transferencia').filter(c => {
      const l = resolverLinha(c.tipo === 'receita' ? 'caixa_receita' : 'caixa_despesa', c.categoria, '', dados.mapaDB)
      return (linha === 'nao_class' || linha === 'rec_nao_class') ? !l : l === linha
    }).map(c => ({ a: c.categoria, b: c.tipo, c: 'total do mês no Balancete', valor: Number(c.valor) }))
  }
  itens.sort((x, y) => y.valor - x.valor)
  const total = itens.reduce((s, i) => s + i.valor, 0)
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 760, maxHeight: '88vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{L.nome} · {rotuloMes(mes)}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{visao === 'competencia' ? 'Competência' : 'Caixa'} · {itens.length} lançamento(s) · R$ {fmt(total)}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {linha === 'cmv' && visao === 'competencia' && (
            <div className="alert-banner info" style={{ marginBottom: 10 }}>
              {extras.cmvFonte === 'sistema'
                ? 'O valor da DRE é o CMV do fechamento do sistema (estoque inicial + compras − estoque final). Abaixo, as compras do mês só para comparação.'
                : 'Mês sem fechamento de CMV no sistema: a DRE usa as compras abaixo.'}
            </div>
          )}
          {!itens.length ? <div style={{ color: 'var(--gray-400)' }}>Nenhum lançamento.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {itens.map((i, k) => (
                  <tr key={k} style={{ borderTop: k ? '1px solid var(--gray-100)' : 'none' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{i.a}</div>
                      {(i.b || i.c) && <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{[i.b, i.c].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)' }}>{i.d || ''}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>R$ {fmt(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Importar e classificar ───────────────────────────────────────────────────
function TelaImportar() {
  const [versao, setVersao] = useState(0) // recarrega a classificação depois de importar
  const [versaoCanais, setVersaoCanais] = useState(0) // a receita mostra o total das plataformas
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ImportarCompetencia onImportou={() => setVersao(v => v + 1)} />
        <ImportarBalancete onImportou={() => setVersao(v => v + 1)} />
      </div>
      <FaturamentoPlataformas onMudou={() => setVersaoCanais(v => v + 1)} />
      <ReceitaCompetencia versaoCanais={versaoCanais} />
      <Classificar key={versao} />
    </div>
  )
}

function CampoArquivo({ onTexto, rotulo }) {
  const ref = useRef()
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()}><Upload size={13} /> {rotulo}</button>
      <input ref={ref} type="file" accept=".csv,.txt" style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          const r = new FileReader()
          r.onload = () => onTexto(String(r.result), f.name)
          r.readAsText(f, 'utf-8')
        }} />
    </>
  )
}

function ImportarCompetencia({ onImportou }) {
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)

  function ler(texto, nome) {
    setMsg(null)
    try {
      const contas = lerContasCompetencia(texto)
      const meses = [...new Set(contas.map(c => c.competencia.slice(0, 7)))].sort()
      setPrev({ contas, meses, nome, total: contas.reduce((s, c) => s + c.valor, 0) })
    } catch (e) { setPrev(null); setMsg({ tipo: 'danger', txt: e.message }) }
  }

  async function importar() {
    setSalvando(true); setMsg(null)
    try {
      // Mês fechado (cadeado) não é substituído
      const { data: fech, error: eF } = await supabase.from('dre_mes').select('mes').eq('visao', 'competencia').not('fechado_em', 'is', null)
      const fechados = new Set(eF ? [] : (fech || []).map(r => r.mes))
      const meses = prev.meses.filter(m => !fechados.has(m))
      let contas = prev.contas.filter(c => !fechados.has(c.competencia.slice(0, 7)))
      // Antes do financeiro_dre_2.sql as colunas de data não existem
      const { error: eCol } = await supabase.from('dre_contas_competencia').select('data_baixa').limit(1)
      if (eCol) contas = contas.map(({ vencimento, data_baixa, ...c }) => c)
      for (const m of meses) {
        const fim = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()
        const { error } = await supabase.from('dre_contas_competencia').delete()
          .gte('competencia', `${m}-01`).lte('competencia', `${m}-${fim}`)
        if (error) throw error
      }
      for (let i = 0; i < contas.length; i += 500) {
        const { error } = await supabase.from('dre_contas_competencia').insert(contas.slice(i, i + 500))
        if (error) throw error
      }
      const pulados = prev.meses.filter(m => fechados.has(m))
      const semBaixa = !prev.contas.some(c => c.data_baixa)
      setMsg({ tipo: 'ok', txt: `${contas.length} contas importadas (${meses.length} meses substituídos).`
        + (pulados.length ? ` Meses fechados não foram alterados: ${pulados.map(rotuloMes).join(', ')}.` : '')
        + (semBaixa ? ' O arquivo não tem a coluna de data de pagamento: a data de baixa fica em branco.' : '') })
      setPrev(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL : 'Erro ao importar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Despesas por competência</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Bling › Financeiro › Relatórios › <b>Contas a pagar por competência</b> › Visualizar › Exportar (CSV).
        Pode exportar tudo: cada mês do arquivo substitui o que já estava no sistema (menos os meses fechados).
        Para ter a data de baixa de cada conta, inclua no relatório do Bling (Configurar › +) a coluna de data de pagamento.
      </div>
      <CampoArquivo rotulo="Escolher arquivo" onTexto={ler} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div><b>{prev.contas.length}</b> contas · {rotuloMes(prev.meses[0])} a {rotuloMes(prev.meses[prev.meses.length - 1])} · R$ {fmt(prev.total)}</div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Importar
          </button>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

function ImportarBalancete({ onImportou }) {
  const [prev, setPrev] = useState(null)
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)

  function ler(texto) {
    setMsg(null)
    try {
      const b = lerBalancete(texto)
      const soma = t => b.linhas.filter(l => l.tipo === t).reduce((s, l) => s + l.valor, 0)
      setPrev({ ...b, receitas: soma('receita'), despesas: soma('despesa') })
    } catch (e) { setPrev(null); setMsg({ tipo: 'danger', txt: e.message }) }
  }

  async function importar() {
    setSalvando(true); setMsg(null)
    try {
      const { data: fech } = await supabase.from('dre_mes').select('fechado_em').eq('mes', prev.mes).eq('visao', 'caixa').maybeSingle()
      if (fech?.fechado_em) throw new Error(`${rotuloMes(prev.mes)} está fechado no caixa (cadeado). Abra o cadeado antes de importar de novo.`)
      const { error: e1 } = await supabase.from('dre_caixa').delete().eq('mes', prev.mes)
      if (e1) throw e1
      // Mesma categoria repetida no arquivo (raro): soma
      const porChave = {}
      for (const l of prev.linhas) {
        const k = `${l.tipo}|${l.categoria}`
        porChave[k] = porChave[k] ? { ...porChave[k], valor: porChave[k].valor + l.valor } : { mes: prev.mes, ...l }
      }
      const { error: e2 } = await supabase.from('dre_caixa').insert(Object.values(porChave))
      if (e2) throw e2
      if (prev.totais['Saldo final'] != null) // para a conferência com o saldo dos bancos
        await supabase.from('dre_mes').upsert({ mes: prev.mes, visao: 'caixa', saldo_final_bling: prev.totais['Saldo final'], atualizado_em: new Date().toISOString() }, { onConflict: 'mes,visao' })
      setMsg({ tipo: 'ok', txt: `Balancete de ${rotuloMes(prev.mes)} importado.` })
      setPrev(null); onImportou()
    } catch (e) { setMsg({ tipo: 'danger', txt: semTabela(e) ? AVISO_SQL : 'Erro ao importar: ' + (e.message || e) }) }
    setSalvando(false)
  }

  const confere = prev && Math.abs(prev.receitas - (prev.totais['Total de receitas'] ?? prev.receitas)) < 0.01
    && Math.abs(prev.despesas - (prev.totais['Total de despesas'] ?? prev.despesas)) < 0.01

  return (
    <div className="card card-pad">
      <div style={{ fontWeight: 800, fontSize: 14 }}>Caixa (Balancete)</div>
      <div style={{ fontSize: 12, color: 'var(--gray-500)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Bling › Financeiro › Relatórios › <b>Balancete</b> › "Do mês" › Visualizar › Exportar (CSV). Um mês por arquivo.
      </div>
      <CampoArquivo rotulo="Escolher arquivo" onTexto={ler} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div><b>{rotuloMes(prev.mes)}</b> · receitas R$ {fmt(prev.receitas)} · despesas R$ {fmt(prev.despesas)}</div>
          <div style={{ fontSize: 12, color: confere ? 'var(--ok)' : 'var(--danger)' }}>
            {confere ? '✓ Bate com os totais do Balancete' : '⚠️ Não bate com os totais do Balancete — confira o arquivo'}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={importar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Importar
          </button>
        </div>
      )}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
    </div>
  )
}

// ── Faturamento das plataformas (iFood, 99 Food, Keeta, Anota.AI) ────────────
// Um lançamento por mês × canal × unidade, lido do print do portal ou digitado.
// Vai para a DRE: vendas → Receita Delivery; promoções → Deduções; taxas + serviços − ajustes → Comercial;
// pacote de anúncios → Marketing.
const AVISO_SQL_3 = 'Aplique o arquivo financeiro_dre_3.sql no Supabase para lançar o faturamento das plataformas.'
const CAMPOS_CANAL = [
  ['vendas', 'Valor das vendas', 'Receita bruta · Delivery'],
  ['promocoes', 'Promoções', 'Deduções · promoções'],
  ['taxas', 'Taxas e comissões', 'Comercial · comissão e taxas'],
  ['servicos', 'Serviços sem anúncios (entrega sob demanda…)', 'Comercial · comissão e taxas'],
  ['marketing', 'Pacote de anúncios', 'Marketing'],
  ['ajustes', 'Ajustes (+ a favor da loja)', 'abate de comissão e taxas'],
]
const numTxt = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const txtNum = v => v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',')
const mesPassado = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const naFila = x => ({ ...x, _k: Date.now() + Math.random() })
const ORIGENS = { print: 'print', portal: 'portal iFood', planilha: 'planilha', shopify: 'Shopify', digitado: 'digitado' }
const rotuloOrigem = o => ORIGENS[o] || 'digitado'
const normalizarCanal = p => {
  const k = String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return PLATAFORMAS.find(x => x.canal.toLowerCase().replace(/[^a-z0-9]/g, '') === k)?.canal || (p || 'iFood')
}
// Linha do banco → formulário (valores em texto, com vírgula)
const paraForm = r => ({
  ...r, ...Object.fromEntries(CAMPOS_CANAL.map(([k]) => [k, txtNum(r[k])])), total_faturamento: txtNum(r.total_faturamento),
})
const doForm = f => ({
  vendas: numTxt(f.vendas), promocoes: numTxt(f.promocoes), taxas: numTxt(f.taxas), servicos: numTxt(f.servicos),
  marketing: numTxt(f.marketing), ajustes: numTxt(f.ajustes),
  total_faturamento: String(f.total_faturamento ?? '').trim() === '' ? null : numTxt(f.total_faturamento),
})

function FaturamentoPlataformas({ onMudou }) {
  const [mes, setMes] = useState(mesPassado)
  const [todas, setTodas] = useState([])   // todos os meses: ensina nome da loja → unidade
  const [fechados, setFechados] = useState(new Set())
  const [semTab, setSemTab] = useState(false)
  const [fila, setFila] = useState([])     // lançamentos para revisar (prints lidos, novo, edição)
  const [lendo, setLendo] = useState(0)
  const [buscandoSite, setBuscandoSite] = useState(false)
  const [msg, setMsg] = useState(null)
  const ref = useRef()

  // Site: pedidos do mês direto da Shopify (brindes da régua já ficam de fora) → fila de revisão
  async function buscarShopify() {
    setBuscandoSite(true); setMsg(null)
    try {
      const r = await fetch(`/api/shopify-faturamento?mes=${mes}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Falha ao buscar na Shopify (${r.status})`)
      const e = j.faturamento
      const fora = [e.fora.cancelados && `${e.fora.cancelados} cancelado(s)`, e.fora.naoPagos && `${e.fora.naoPagos} não pago(s)`, e.fora.teste && `${e.fora.teste} de teste`].filter(Boolean)
      setFila(q => [...q, naFila({
        ...paraForm(e), origem: 'shopify', arquivo: 'Shopify',
        aviso: [`${e.pedidos} pedido(s) de ${rotuloMes(e.mes)}${fora.length ? ` (fora: ${fora.join(', ')})` : ''}.`,
          e.brindes.quantidade ? `Brindes da régua fora da receita: ${e.brindes.quantidade} un., R$ ${fmt(e.brindes.valor)}.` : '',
          e.vouchers?.quantidade ? `Vouchers de influenciadores fora da receita: ${e.vouchers.quantidade}, R$ ${fmt(e.vouchers.valor)} (custo dos produtos já está no CMV).` : '', ...e.avisos].filter(Boolean).join(' '),
      })])
    } catch (e) { setMsg({ tipo: 'danger', txt: `Shopify: ${e.message || e}` }) }
    setBuscandoSite(false)
  }

  async function carregar() {
    const [{ data, error }, { data: fech }] = await Promise.all([
      supabase.from('dre_canal_competencia').select('*').order('canal').order('unidade'),
      supabase.from('dre_mes').select('mes').eq('visao', 'competencia').not('fechado_em', 'is', null),
    ])
    if (error) { if (semTabela(error)) setSemTab(true); else setMsg({ tipo: 'danger', txt: error.message }); return }
    setSemTab(false); setTodas(data || []); setFechados(new Set((fech || []).map(r => r.mes)))
  }
  useEffect(() => { carregar() }, [])

  // Print: lê cada arquivo e põe na fila de revisão (nada é salvo sem conferir)
  async function lerArquivos(files) {
    const ehPlanilha = f => /\.xlsx$/i.test(f.name || '')
    const lista = [...files].filter(f => /^image\/|pdf$/.test(f.type) || ehPlanilha(f))
    if (!lista.length) return
    setMsg(null); setLendo(n => n + lista.length)
    for (const file of lista) {
      try {
        if (ehPlanilha(file)) {
          // 99 Food ou Keeta: uma entrada por loja × mês da planilha
          const dados = await file.arrayBuffer()
          let meses
          try { meses = await lerPlanilha99(dados, todas.filter(x => x.canal === '99 Food')) } catch (e99) {
            if (!/Não achei a aba/.test(e99.message)) throw e99
            try { meses = await lerPlanilhaKeeta(dados) } catch (eK) {
              if (!/Não achei a aba/.test(eK.message)) throw eK
              throw new Error('planilha não reconhecida: use a "Detalhes da fatura" da 99 Food ou o "Billing report" da Keeta.')
            }
          }
          if (!meses.length) throw new Error('Nenhum pedido encontrado na planilha.')
          setFila(q => [...q, ...meses.map(e => naFila({
            ...paraForm(e), origem: 'planilha', arquivo: file.name,
            aviso: [`${e.pedidos} pedido(s) de ${rotuloMes(e.mes)} somados da planilha.`, ...e.avisos].join(' '),
          }))])
          setLendo(n => n - 1)
          continue
        }
        const corpo = await arquivoParaEnvio(file, { rotuloPdf: 'envie um print da tela' })
        const r = await fetch('/api/ler-faturamento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || `Falha na leitura (${r.status})`)
        const p = j.faturamento
        const canal = normalizarCanal(p.plataforma)
        const unidade = siglaUnidade(p.unidade, todas.filter(x => x.canal === canal))
          || (PLATAFORMAS.find(x => x.canal === canal)?.unidades.length === 1 ? PLATAFORMAS.find(x => x.canal === canal).unidades[0] : '')
        setFila(q => [...q, naFila({
          ...paraForm({ ...p, total_faturamento: p.total_faturamento }),
          mes: /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : mes, canal, unidade,
          unidade_print: p.unidade || null, detalhes: p.linhas || [], origem: 'print',
          aviso: p.legivel ? (p.problemas || '') : (p.problemas || 'Leitura incompleta: confira todos os valores.'),
          ilegivel: !p.legivel, arquivo: file.name || 'print colado',
        })])
      } catch (e) { setMsg({ tipo: 'danger', txt: `${file.name || 'Print'}: ${e.message || e}` }) }
      setLendo(n => n - 1)
    }
  }

  // Ctrl+V de um print em qualquer lugar da tela de importação
  useEffect(() => {
    const colar = e => {
      const arqs = [...(e.clipboardData?.files || [])]
      if (arqs.some(f => f.type.startsWith('image/'))) { e.preventDefault(); lerArquivos(arqs) }
    }
    document.addEventListener('paste', colar)
    return () => document.removeEventListener('paste', colar)
  })

  async function excluir(r) {
    if (!window.confirm(`Excluir o faturamento de ${rotuloCanal(r)} em ${rotuloMes(r.mes)}?`)) return
    const { error } = await supabase.from('dre_canal_competencia').delete().eq('id', r.id)
    if (error) { setMsg({ tipo: 'danger', txt: error.message }); return }
    setMsg({ tipo: 'ok', txt: `${rotuloCanal(r)} de ${rotuloMes(r.mes)} excluído.` }); carregar(); onMudou()
  }

  const doMes = todas.filter(r => r.mes === mes)
  const fechado = fechados.has(mes)
  const soma = k => doMes.reduce((s, r) => s + (typeof k === 'function' ? k(r) : Number(r[k]) || 0), 0)
  const th = { padding: '6px 8px', textAlign: 'right', fontSize: 11, color: 'var(--gray-500)', fontWeight: 700, whiteSpace: 'nowrap' }
  const td = { padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Faturamento das plataformas (competência)</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5, marginTop: 2 }}>
            <b>iFood:</b> Financeiro › Faturamento do mês, uma loja por print (com os grupos abertos); envie ou cole (Ctrl+V).{' '}
            <b>99 Food:</b> planilha "Detalhes da fatura" (.xlsx) de cada loja; pode ser de vários meses, o sistema separa pelo mês da cobrança.{' '}
            <b>Keeta:</b> Financials › Download › Billing report (.xlsx) do mês.{' '}
            <b>Site:</b> busca os pedidos do mês direto na Shopify (brindes da régua ficam fora da receita e dos descontos).
            Você confere cada loja × mês antes de salvar.
          </div>
        </div>
        <input type="month" className="form-input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 160, fontSize: 13 }} />
        <button className="btn btn-primary btn-sm" disabled={semTab || lendo > 0} onClick={() => ref.current?.click()}>
          {lendo > 0 ? <RefreshCw size={13} className="spin" /> : <Camera size={13} />} {lendo > 0 ? `Lendo ${lendo} arquivo(s)…` : 'Ler print ou planilha'}
        </button>
        <button className="btn btn-primary btn-sm" disabled={semTab || fechado || buscandoSite} onClick={buscarShopify} title="Pedidos do mês na Shopify, sem os brindes da régua">
          {buscandoSite ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />} {buscandoSite ? 'Buscando na Shopify…' : 'Site: buscar na Shopify'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={semTab || fechado}
          onClick={() => setFila(q => [...q, naFila(paraForm({ mes, canal: 'iFood', unidade: 'BV', origem: 'digitado' }))])}>
          <Plus size={13} /> Digitar
        </button>
        <input ref={ref} type="file" multiple accept="image/*,application/pdf,.xlsx" style={{ display: 'none' }}
          onChange={e => { const fs = e.target.files; lerArquivos(fs); e.target.value = '' }} />
      </div>

      {semTab && <div className="alert-banner info" style={{ marginTop: 10 }}>{AVISO_SQL_3}</div>}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.txt}</div>}
      {fechado && <div style={{ fontSize: 12, color: 'var(--ok)', marginTop: 8 }}><Lock size={12} style={{ verticalAlign: -2 }} /> {rotuloMes(mes)} fechado na DRE: abra o cadeado para alterar.</div>}

      {!semTab && (doMes.length ? (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--gray-200)' }}>
                <th style={{ ...th, textAlign: 'left' }}>Loja</th>
                <th style={th}>Vendas</th><th style={th}>Promoções</th><th style={th}>Comissão e taxas</th><th style={th}>Anúncios</th>
                <th style={th} title="vendas − promoções − comissão e taxas − anúncios">Recebido</th><th style={th}>Portal</th><th />
              </tr>
            </thead>
            <tbody>
              {doMes.map(r => {
                const bate = r.total_faturamento == null ? null : Math.abs(liquidoCanal(r) - Number(r.total_faturamento)) < 0.05
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700 }}>
                      {rotuloCanal(r)}
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--gray-400)' }}> · {rotuloOrigem(r.origem)}</span>
                    </td>
                    <td style={td}>{fmt(r.vendas)}</td>
                    <td style={td}>{fmt(r.promocoes)}</td>
                    <td style={td} title={`taxas ${fmt(r.taxas)} + serviços ${fmt(r.servicos)} − ajustes ${fmt(r.ajustes)}`}>{fmt(custoCanal(r))}</td>
                    <td style={td}>{marketingCanal(r) ? fmt(marketingCanal(r)) : '—'}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmt(liquidoCanal(r))}</td>
                    <td style={{ ...td, fontSize: 12, color: bate == null ? 'var(--gray-300)' : bate ? 'var(--ok)' : 'var(--danger)' }}
                      title={r.total_faturamento == null ? 'Sem total do portal' : `Total do faturamento no portal: R$ ${fmt(r.total_faturamento)}`}>
                      {bate == null ? '—' : bate ? '✓ bate' : `⚠ ${fmt(r.total_faturamento)}`}
                    </td>
                    <td style={{ ...td, width: 70 }}>
                      {!fechado && <>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => setFila(q => [...q, naFila(paraForm(r))])}><Pencil size={12} /></button>
                        <button className="btn btn-ghost btn-xs" title="Excluir" onClick={() => excluir(r)}><Trash2 size={12} /></button>
                      </>}
                    </td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '2px solid var(--gray-200)', fontWeight: 800 }}>
                <td style={{ padding: '6px 8px' }}>Total {rotuloMes(mes)}</td>
                <td style={td}>{fmt(soma('vendas'))}</td><td style={td}>{fmt(soma('promocoes'))}</td>
                <td style={td}>{fmt(soma(custoCanal))}</td><td style={td}>{fmt(soma(marketingCanal))}</td><td style={td}>{fmt(soma(liquidoCanal))}</td><td /><td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--gray-400)', marginTop: 10 }}>Nenhuma loja lançada em {rotuloMes(mes)}.</div>
      ))}

      {fila.length > 0 && (
        <ModalCanal key={fila[0]._k} inicial={fila[0]} restantes={fila.length - 1} todas={todas} fechados={fechados}
          onFechar={() => setFila(q => q.slice(1))}
          onSalvou={m => { setFila(q => q.slice(1)); setMes(m); carregar(); onMudou() }} />
      )}
    </div>
  )
}

function ModalCanal({ inicial, restantes, todas, fechados, onFechar, onSalvou }) {
  const [f, setF] = useState(inicial)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [verLinhas, setVerLinhas] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v, alterado: p.alterado || CAMPOS_CANAL.some(([c]) => c === k) }))

  const v = doForm(f)
  const custo = custoCanal(v), anuncios = marketingCanal(v), liquido = liquidoCanal(v)
  const bate = v.total_faturamento == null ? null : Math.abs(liquido - v.total_faturamento) < 0.05
  const unidades = PLATAFORMAS.find(x => x.canal === f.canal)?.unidades || []
  const existente = todas.find(r => r.mes === f.mes && r.canal === f.canal && r.unidade === (f.unidade || '') && r.id !== f.id)
  const fechado = fechados.has(f.mes)

  async function salvar() {
    setErro('')
    if (!/^\d{4}-\d{2}$/.test(f.mes || '')) return setErro('Escolha o mês do faturamento.')
    if (!f.canal) return setErro('Escolha a plataforma.')
    if (unidades.length > 1 && !f.unidade) return setErro(`Escolha a unidade (${unidades.join(', ')}).`)
    if (!(v.vendas > 0)) return setErro('Valor das vendas em branco.')
    if (fechado) return setErro(`${rotuloMes(f.mes)} está fechado na DRE: abra o cadeado antes.`)
    if (existente && !window.confirm(`${rotuloCanal(f)} já tem faturamento em ${rotuloMes(f.mes)} (vendas R$ ${fmt(existente.vendas)}). Substituir?`)) return
    if (bate === false && !window.confirm(`As linhas dão R$ ${fmt(liquido)} e o total do portal é R$ ${fmt(v.total_faturamento)}. Salvar mesmo assim?`)) return
    setSalvando(true)
    const linha = {
      mes: f.mes, canal: f.canal, unidade: f.unidade || '', ...v,
      unidade_print: f.unidade_print || null, detalhes: f.detalhes || null, origem: f.alterado || !ORIGENS[f.origem] ? 'digitado' : f.origem,
      atualizado_em: new Date().toISOString(), atualizado_por: usuarioNome(),
    }
    const { error } = await supabase.from('dre_canal_competencia').upsert(linha, { onConflict: 'mes,canal,unidade' })
    // Edição que mudou mês, canal ou unidade: apaga o lançamento antigo
    if (!error && f.id) {
      const orig = todas.find(r => r.id === f.id)
      if (orig && (orig.mes !== linha.mes || orig.canal !== linha.canal || orig.unidade !== linha.unidade))
        await supabase.from('dre_canal_competencia').delete().eq('id', f.id)
    }
    setSalvando(false)
    if (error) return setErro(semTabela(error) ? AVISO_SQL_3 : error.message)
    onSalvou(f.mes)
  }

  const lbl = { fontSize: 12 }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="modal" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{f.id ? 'Editar faturamento' : f.origem === 'print' ? 'Conferir print' : f.origem === 'planilha' ? 'Conferir planilha' : 'Digitar faturamento'}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {['print', 'planilha'].includes(f.origem) && f.arquivo ? `Lido de ${f.arquivo}${f.unidade_print ? ` · loja: "${f.unidade_print}"` : ''}` : 'Valores do Faturamento do portal'}
              {restantes > 0 && ` · mais ${restantes} na fila`}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onFechar}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {f.aviso && <div className={`alert-banner ${f.ilegivel ? 'danger' : 'warning'}`} style={{ marginBottom: 10 }}>{f.aviso}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Mês (competência)</label>
              <input type="month" className="form-input" value={f.mes || ''} onChange={e => set('mes', e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Plataforma</label>
              <select className="form-input" value={f.canal} onChange={e => {
                const c = e.target.value, us = PLATAFORMAS.find(x => x.canal === c)?.unidades || []
                setF(p => ({ ...p, canal: c, unidade: us.includes(p.unidade) ? p.unidade : (us.length === 1 ? us[0] : '') }))
              }}>
                {[...new Set([...PLATAFORMAS.map(x => x.canal), f.canal])].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={lbl}>Unidade</label>
              <input className="form-input" list="unidades-canal" value={f.unidade || ''} placeholder={unidades.join(', ') || '—'}
                onChange={e => set('unidade', e.target.value.toUpperCase().trim())}
                style={{ borderColor: unidades.length > 1 && !f.unidade ? 'var(--danger)' : undefined }} />
              <datalist id="unidades-canal">{unidades.filter(Boolean).map(u => <option key={u} value={u} />)}</datalist>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {CAMPOS_CANAL.map(([k, nome, destino]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{k === 'marketing' && f.canal === 'Site' ? 'Vouchers de influenciadores' : nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{k === 'vendas' && f.canal === 'Site' ? 'Receita bruta · Venda Site' : destino}</div>
                </div>
                <input className="form-input" inputMode="decimal" placeholder="0,00" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} style={{ textAlign: 'right' }} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center', borderTop: '1px solid var(--gray-100)', paddingTop: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Total do faturamento no portal</div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>opcional, só para conferir</div>
              </div>
              <input className="form-input" inputMode="decimal" placeholder="0,00" value={f.total_faturamento ?? ''} onChange={e => set('total_faturamento', e.target.value)} style={{ textAlign: 'right' }} />
            </div>
          </div>

          <div style={{ marginTop: 12, background: 'var(--gray-50)', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>Vai para a DRE de {f.mes ? rotuloMes(f.mes) : '—'} como {rotuloCanal(f) || f.canal}</div>
            <div>Receita bruta · {f.canal === 'Site' ? 'Venda Site' : 'Delivery'}: <b>R$ {fmt(v.vendas)}</b></div>
            <div>Deduções · promoções: <b>− R$ {fmt(v.promocoes)}</b></div>
            <div>Comercial · comissão e taxas: <b>− R$ {fmt(custo)}</b>
              <span style={{ color: 'var(--gray-500)' }}> ({fmt(v.taxas)} + {fmt(v.servicos)} − {fmt(v.ajustes)} de ajustes)</span></div>
            {anuncios !== 0 && <div>Marketing · {f.canal === 'Site' ? 'influenciadores (vouchers)' : 'anúncios'}: <b>− R$ {fmt(anuncios)}</b></div>}
            <div style={{ color: bate == null ? 'var(--gray-500)' : bate ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
              Recebido pela loja: R$ {fmt(liquido)}
              {bate == null ? '' : bate ? ' ✓ bate com o total do portal' : ` ⚠ o portal diz R$ ${fmt(v.total_faturamento)} (diferença R$ ${fmt(liquido - v.total_faturamento)})`}
            </div>
          </div>

          {f.detalhes?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-xs" onClick={() => setVerLinhas(x => !x)}>
                {verLinhas ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Linhas lidas ({f.detalhes.length})
              </button>
              {verLinhas && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 4 }}>
                  <tbody>
                    {f.detalhes.map((d, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--gray-100)' }}>
                        <td style={{ padding: '3px 6px', color: 'var(--gray-400)' }}>{d.grupo}</td>
                        <td style={{ padding: '3px 6px' }}>{d.descricao}</td>
                        <td style={{ padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: d.valor < 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmt(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {existente && <div className="alert-banner warning" style={{ marginTop: 10 }}>Já existe {rotuloCanal(existente)} em {rotuloMes(existente.mes)} (vendas R$ {fmt(existente.vendas)}): salvar substitui.</div>}
          {erro && <div className="alert-banner danger" style={{ marginTop: 10 }}>{erro}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onFechar}>{restantes > 0 ? 'Pular' : 'Cancelar'}</button>
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || fechado}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function ReceitaCompetencia({ versaoCanais }) {
  const hoje = new Date()
  const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
  const [mes, setMes] = useState(`${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`)
  const [valores, setValores] = useState({})
  const [msg, setMsg] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [fechado, setFechado] = useState(false)
  const [plataformas, setPlataformas] = useState({}) // vendas das plataformas por linha (Delivery, Site)

  useEffect(() => {
    supabase.from('dre_canal_competencia').select('canal, vendas').eq('mes', mes)
      .then(({ data, error }) => setPlataformas(error ? {} : (data || []).reduce((s, r) => {
        const l = r.canal === 'Site' ? 'rec_site' : 'rec_delivery'
        return { ...s, [l]: (s[l] || 0) + (Number(r.vendas) || 0) }
      }, {})))
  }, [mes, versaoCanais])

  useEffect(() => {
    setMsg(null)
    supabase.from('dre_mes').select('fechado_em').eq('mes', mes).eq('visao', 'competencia').maybeSingle()
      .then(({ data }) => setFechado(!!data?.fechado_em))
    supabase.from('dre_receita_competencia').select('linha, valor').eq('mes', mes).then(({ data, error }) => {
      if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message }); return }
      setValores(Object.fromEntries((data || []).map(r => [r.linha, String(r.valor).replace('.', ',')])))
    })
  }, [mes])

  const num = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const somaPlat = Object.values(plataformas).reduce((s, x) => s + x, 0)
  const total = RECEITAS.reduce((s, l) => s + num(valores[l]), 0) + somaPlat

  async function salvar() {
    setSalvando(true); setMsg(null)
    const quem = usuarioNome()
    const rows = RECEITAS.map(l => ({ mes, linha: l, valor: num(valores[l]), atualizado_em: new Date().toISOString(), atualizado_por: quem }))
    const { error } = await supabase.from('dre_receita_competencia').upsert(rows, { onConflict: 'mes,linha' })
    setSalvando(false)
    setMsg(error ? { tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message } : { tipo: 'ok', txt: `Receita de ${rotuloMes(mes)} salva.` })
  }

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 14, flex: '1 1 200px' }}>Receita por competência (digitada)</div>
        <input type="month" className="form-input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 160, fontSize: 13 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {RECEITAS.map(l => (
          <div key={l} className="form-group" style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: 12 }}>{LINHAS[l].nome}</label>
            <input className="form-input" inputMode="decimal" placeholder="0,00" value={valores[l] || ''} disabled={fechado}
              onChange={e => setValores(v => ({ ...v, [l]: e.target.value }))} style={{ textAlign: 'right' }} />
            {plataformas[l] > 0 && (
              <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 3 }}>
                {l === 'rec_site'
                  ? <>+ R$ {fmt(plataformas[l])} da Shopify (somado sozinho). Digite aqui só venda do site que não passou pela Shopify.</>
                  : <>+ R$ {fmt(plataformas[l])} das plataformas (somado sozinho). Digite aqui só o delivery que não tem faturamento lançado acima.</>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>Total{somaPlat > 0 ? ' com plataformas' : ''}: <b>R$ {fmt(total)}</b></div>
        {fechado
          ? <span style={{ fontSize: 12, color: 'var(--ok)' }}><Lock size={12} style={{ verticalAlign: -2 }} /> {rotuloMes(mes)} fechado na DRE: abra o cadeado para alterar.</span>
          : <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>
              {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar receita de {rotuloMes(mes)}
            </button>}
        {msg && <div className={`alert-banner ${msg.tipo}`} style={{ padding: '6px 10px' }}>{msg.txt}</div>}
      </div>
    </div>
  )
}

// Categorias sem linha (e as ambíguas, por fornecedor) + todas as categorias para ajustar
function Classificar() {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [escolhas, setEscolhas] = useState({}) // chave → { linha, todaCategoria }
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)

  async function carregar() {
    setErro('')
    try {
      const [contas, caixa, mapaDB] = await Promise.all([
        buscarTudo(() => supabase.from('dre_contas_competencia').select('*')),
        buscarTudo(() => supabase.from('dre_caixa').select('mes, tipo, categoria, valor')),
        buscarTudo(() => supabase.from('dre_mapa').select('origem, categoria, nome, linha')),
      ])
      setDados({ contas, caixa, mapaDB }); setEscolhas({})
    } catch (e) { setErro(semTabela(e) ? AVISO_SQL : e.message || String(e)) }
  }
  useEffect(() => { carregar() }, [])

  const { pendentes } = useMemo(() => {
    if (!dados) return { pendentes: [] }
    const pend = new Map()
    const add = (mapa, k, base, v) => { const p = mapa.get(k) || { ...base, qtd: 0, valor: 0 }; p.qtd++; p.valor += Number(v) || 0; mapa.set(k, p) }
    for (const c of dados.contas) {
      const cat = c.categoria || ''
      if (!resolverLinha('competencia', cat, c.nome, dados.mapaDB))
        add(pend, `competencia|${cat}|${c.nome || ''}`, { origem: 'competencia', categoria: cat, nome: c.nome || '' }, c.valor)
    }
    for (const c of dados.caixa) {
      if (c.tipo === 'transferencia') continue
      const origem = c.tipo === 'receita' ? 'caixa_receita' : 'caixa_despesa'
      if (!resolverLinha(origem, c.categoria, '', dados.mapaDB))
        add(pend, `${origem}|${c.categoria}|`, { origem, categoria: c.categoria, nome: '' }, c.valor)
    }
    return {
      pendentes: [...pend.values()].sort((a, b) => a.categoria.localeCompare(b.categoria) || b.valor - a.valor),
    }
  }, [dados])

  const ORIGEM = { competencia: 'Competência', caixa_receita: 'Caixa · receita', caixa_despesa: 'Caixa · despesa' }
  const chave = p => `${p.origem}|${p.categoria}|${p.nome || ''}`
  const mudar = (k, campo, v) => setEscolhas(s => ({ ...s, [k]: { ...s[k], [campo]: v } }))
  const qtdEscolhidas = Object.values(escolhas).filter(e => e.linha).length

  async function salvar() {
    setSalvando(true); setMsg(null)
    const rows = []
    for (const [k, e] of Object.entries(escolhas)) {
      if (!e.linha) continue
      const [origem, categoria, nome] = k.split('|')
      rows.push({ origem, categoria, nome: e.todaCategoria ? '' : nome, linha: e.linha, atualizado_em: new Date().toISOString() })
    }
    // Mesma chave escolhida duas vezes (categoria toda): fica a última
    const unicos = Object.values(Object.fromEntries(rows.map(r => [`${r.origem}|${r.categoria}|${r.nome}`, r])))
    const { error } = await supabase.from('dre_mapa').upsert(unicos, { onConflict: 'origem,categoria,nome' })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? AVISO_SQL : error.message }); return }
    setMsg({ tipo: 'ok', txt: `${unicos.length} classificação(ões) salva(s).` })
    carregar()
  }

  const seletor = (k, atual) => (
    <select className="form-input" value={escolhas[k]?.linha ?? ''} onChange={e => mudar(k, 'linha', e.target.value)} style={{ fontSize: 12, minWidth: 220 }}>
      <option value="">{atual ? `${LINHAS[atual].nome} (atual)` : '— escolher linha —'}</option>
      {LINHAS_ESCOLHA.map(l => <option key={l} value={l}>{LINHAS[l].nome}</option>)}
    </select>
  )

  return (
    <div className="card">
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Classificar categorias na DRE</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            Categorias com o mesmo nome em várias áreas ({AMBIGUAS.filter(Boolean).slice(0, 5).join(', ')}…) são classificadas por fornecedor. Basta uma vez: os próximos meses usam a mesma escolha.
          </div>
        </div>
        {qtdEscolhidas > 0 && (
          <button className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>
            {salvando ? <RefreshCw size={13} className="spin" /> : <Save size={13} />} Salvar {qtdEscolhidas} classificação(ões)
          </button>
        )}
      </div>
      {erro && <div className="alert-banner danger" style={{ margin: 12 }}>{erro}</div>}
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ margin: 12 }}>{msg.txt}</div>}
      {dados && (
        <>
          {!pendentes.length ? (
            <div style={{ padding: 16, color: 'var(--ok)', fontSize: 13 }}>✓ Todas as categorias importadas têm linha na DRE.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  {['Categoria no Bling', 'Fornecedor', 'Lançamentos', 'Linha da DRE', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 10px', paddingLeft: i ? 10 : 16, textAlign: i === 2 ? 'right' : 'left', fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendentes.map(p => {
                  const k = chave(p)
                  return (
                    <tr key={k} style={{ borderTop: '1px solid var(--gray-100)' }}>
                      <td style={{ padding: '7px 10px 7px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{p.categoria || '(sem categoria)'}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{ORIGEM[p.origem]}</div>
                      </td>
                      <td style={{ padding: '7px 10px' }}>{p.nome || '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p.qtd} · R$ {fmt(p.valor)}
                      </td>
                      <td style={{ padding: '7px 10px' }}>{seletor(k)}</td>
                      <td style={{ padding: '7px 16px 7px 10px' }}>
                        {p.nome && (
                          <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={!!escolhas[k]?.todaCategoria} onChange={e => mudar(k, 'todaCategoria', e.target.checked)} />
                            vale para toda a categoria
                          </label>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <MapaPorLinha dados={dados} seletor={seletor} />
        </>
      )}
    </div>
  )
}

// O que entra em cada linha da DRE: categorias (e fornecedores, quando classificados
// um a um) com o total e, na competência, as contas de cada uma. Dá para trocar a linha aqui.
const dataCurta = d => d ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : ''
const ORDEM_LINHAS = [...ESTRUTURA.filter(e => e.tipo === 'grupo').flatMap(e => e.linhas), 'ignorar']
const LIMITE_CONTAS = 300

function MapaPorLinha({ dados, seletor }) {
  const [visao, setVisao] = useState('competencia')
  const [mes, setMes] = useState('')
  const [fechadas, setFechadas] = useState(() => new Set())   // linhas da DRE fechadas
  const [abertas, setAbertas] = useState(() => new Set())     // categorias com as contas abertas

  const meses = useMemo(() => [...new Set(visao === 'competencia'
    ? dados.contas.map(c => (c.competencia || '').slice(0, 7))
    : dados.caixa.map(c => c.mes))].filter(Boolean).sort().reverse(), [dados, visao])

  const grupos = useMemo(() => {
    const g = {}
    const somar = (linha, k, base, valor, conta) => {
      const m = g[linha] || (g[linha] = new Map())
      const it = m.get(k) || { ...base, k, qtd: 0, valor: 0, contas: [] }
      it.qtd++; it.valor += Number(valor) || 0
      if (conta) it.contas.push(conta)
      m.set(k, it)
    }
    if (visao === 'competencia') {
      for (const c of dados.contas) {
        if (mes && !(c.competencia || '').startsWith(mes)) continue
        const cat = c.categoria || '', nome = c.nome || ''
        const linha = resolverLinha('competencia', cat, nome, dados.mapaDB) || 'nao_class'
        const porNome = AMBIGUAS.includes(cat) ||
          (!!nome && dados.mapaDB.some(m => m.origem === 'competencia' && m.categoria === cat && m.nome === nome))
        somar(linha, `competencia|${cat}|${porNome ? nome : ''}`, { origem: 'competencia', categoria: cat, nome: porNome ? nome : '' }, c.valor, c)
      }
    } else {
      for (const c of dados.caixa) {
        if (c.tipo === 'transferencia' || (mes && c.mes !== mes)) continue
        const origem = c.tipo === 'receita' ? 'caixa_receita' : 'caixa_despesa'
        const linha = resolverLinha(origem, c.categoria, '', dados.mapaDB) || (c.tipo === 'receita' ? 'rec_nao_class' : 'nao_class')
        somar(linha, `${origem}|${c.categoria}|`, { origem, categoria: c.categoria, nome: '' }, c.valor, null)
      }
    }
    return ORDEM_LINHAS.filter(l => g[l]).map(l => {
      const itens = [...g[l].values()].sort((a, b) => b.valor - a.valor)
      return { linha: l, itens, total: itens.reduce((s, i) => s + i.valor, 0) }
    })
  }, [dados, visao, mes])

  const alternar = (atual, setter, k) => { const n = new Set(atual); n.has(k) ? n.delete(k) : n.add(k); setter(n) }

  return (
    <div style={{ borderTop: '1px solid var(--gray-200)' }}>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 14, flex: '1 1 240px' }}>O que entra em cada linha da DRE</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['competencia', 'Competência'], ['caixa', 'Caixa']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${visao === v ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setVisao(v); setMes(''); setAbertas(new Set()) }}>{l}</button>
          ))}
        </div>
        <select className="form-input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 160, fontSize: 13 }}>
          <option value="">Todos os meses</option>
          {meses.map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => setFechadas(fechadas.size ? new Set() : new Set(grupos.map(g => g.linha)))}>
          {fechadas.size ? 'Abrir todas' : 'Fechar todas'}
        </button>
      </div>
      {visao === 'caixa' && (
        <div style={{ padding: '0 16px 10px', fontSize: 12, color: 'var(--gray-500)' }}>
          O Balancete traz só o total de cada categoria principal do Bling. Para ver as contas uma a uma, use a visão de competência.
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {grupos.map(g => {
            const L = LINHAS[g.linha]
            const aberta = !fechadas.has(g.linha)
            return [
              <tr key={g.linha} onClick={() => alternar(fechadas, setFechadas, g.linha)}
                style={{ background: 'var(--gray-50)', borderTop: '1px solid var(--gray-200)', cursor: 'pointer' }}>
                <td colSpan={3} style={{ padding: '8px 16px', fontWeight: 800, color: L.alerta ? 'var(--danger)' : 'var(--gray-800)' }}>
                  {aberta ? <ChevronDown size={13} style={{ verticalAlign: -2 }} /> : <ChevronRight size={13} style={{ verticalAlign: -2 }} />} {L.nome}
                  <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--gray-400)' }}> · {g.itens.length} {g.itens.length === 1 ? 'item' : 'itens'}</span>
                </td>
                <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>R$ {fmt(g.total)}</td>
              </tr>,
              ...(aberta ? g.itens.flatMap(it => {
                const comContas = it.contas.length > 0
                const verContas = abertas.has(it.k)
                const linhas = [(
                  <tr key={it.k} style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '6px 10px 6px 34px', cursor: comContas ? 'pointer' : 'default' }}
                      onClick={() => comContas && alternar(abertas, setAbertas, it.k)}>
                      {comContas && (verContas ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />)}{' '}
                      <span style={{ fontWeight: 600 }}>{it.categoria || '(sem categoria)'}</span>
                      {it.nome && <span style={{ color: 'var(--gray-500)' }}> · {it.nome}</span>}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--gray-500)', fontSize: 12 }}>
                      {it.qtd} {it.qtd === 1 ? 'conta' : 'contas'}
                    </td>
                    <td style={{ padding: '6px 10px' }}>{seletor(it.k, g.linha === 'nao_class' || g.linha === 'rec_nao_class' ? null : g.linha)}</td>
                    <td style={{ padding: '6px 16px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>R$ {fmt(it.valor)}</td>
                  </tr>
                )]
                if (verContas) {
                  const contas = [...it.contas].sort((a, b) => (b.competencia || '').localeCompare(a.competencia || '') || b.valor - a.valor)
                  linhas.push(
                    <tr key={it.k + '-contas'}>
                      <td colSpan={4} style={{ padding: '0 16px 10px 52px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--gray-50)', borderRadius: 6 }}>
                          <thead>
                            <tr style={{ color: 'var(--gray-400)', fontSize: 11 }}>
                              {['Competência', 'Vencimento', 'Baixa', 'Fornecedor', 'Observação', 'Situação', 'Valor'].map((h, i) => (
                                <th key={h} style={{ padding: '4px 8px', textAlign: i === 6 ? 'right' : 'left', fontWeight: 600 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {contas.slice(0, LIMITE_CONTAS).map((c, i) => (
                              <tr key={i} style={{ borderTop: i ? '1px solid var(--gray-100)' : 'none' }}>
                                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--gray-600)' }}>{dataCurta(c.competencia)}</td>
                                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--gray-500)' }}>
                                  {c.vencimento ? dataCurta(c.vencimento) : (mesVencimento(c) ? rotuloMes(mesVencimento(c)) : '—')}
                                </td>
                                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: c.data_baixa ? 'var(--ok)' : 'var(--gray-300)' }}>{c.data_baixa ? dataCurta(c.data_baixa) : '—'}</td>
                                <td style={{ padding: '4px 8px' }}>{c.nome}</td>
                                <td style={{ padding: '4px 8px', color: 'var(--gray-500)' }}>{c.observacoes}</td>
                                <td style={{ padding: '4px 8px', color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{c.situacao}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>R$ {fmt(c.valor)}</td>
                              </tr>
                            ))}
                            {contas.length > LIMITE_CONTAS && (
                              <tr><td colSpan={7} style={{ padding: '4px 8px', color: 'var(--gray-400)' }}>
                                Mostrando {LIMITE_CONTAS} de {contas.length}. Escolha um mês para ver menos.
                              </td></tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )
                }
                return linhas
              }) : []),
            ]
          })}
        </tbody>
      </table>
      <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--gray-400)', borderTop: '1px solid var(--gray-100)' }}>
        Clique no nome da linha para abrir ou fechar e na categoria para ver as contas. Para mover uma categoria (ou um fornecedor) de linha, escolha a nova linha e clique em "Salvar" no topo deste quadro.
      </div>
    </div>
  )
}

// ── Conferência e cadeado do mês ─────────────────────────────────────────────
const ICONE = { ok: '✓', aviso: '!', erro: '✕', info: 'i' }
const COR = { ok: 'var(--ok)', aviso: 'var(--warning)', erro: 'var(--danger)', info: 'var(--gray-500)' }

function ehAdmin() {
  try { return JSON.parse(sessionStorage.getItem('usuario'))?.perfil === 'admin' } catch { return false }
}

function Conferencia({ visao, meses, dados, dre, onMudou }) {
  const [mes, setMes] = useState(meses[meses.length - 1] || '')
  const [abertos, setAbertos] = useState(() => new Set())
  const [saldoTxt, setSaldoTxt] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { if (!meses.includes(mes)) setMes(meses[meses.length - 1] || '') }, [meses.join()])

  const info = dados.mesInfo.find(r => r.mes === mes && r.visao === visao) || null
  useEffect(() => {
    setSaldoTxt(info?.saldo_bancos != null ? String(info.saldo_bancos).replace('.', ',') : '')
    setMsg(null); setAbertos(new Set())
  }, [mes, visao, info?.saldo_bancos])

  if (!mes) return null
  if (dados.semTabelaMes) return (
    <div className="alert-banner info">Conferência e cadeado do mês: aplique o arquivo financeiro_dre_2.sql no Supabase para ativar.</div>
  )

  const fechado = !!info?.fechado_em
  const testes = conferir({ visao, mes, dados, dre, mesInfo: info })
  const problemas = testes.filter(t => t.status === 'erro' || t.status === 'aviso').length
  const num = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null }

  async function gravar(campos, ok) {
    setSalvando(true); setMsg(null)
    const { error } = await supabase.from('dre_mes').upsert({ mes, visao, ...campos, atualizado_em: new Date().toISOString() }, { onConflict: 'mes,visao' })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'danger', txt: semTabela(error) ? 'Aplique o arquivo financeiro_dre_2.sql no Supabase.' : error.message }); return }
    setMsg({ tipo: 'ok', txt: ok }); onMudou()
  }

  function fechar() {
    const aviso = problemas ? `\n\nAtenção: a conferência ainda mostra ${problemas} ponto(s) a verificar.` : ''
    if (!window.confirm(`Fechar ${rotuloMes(mes)} na DRE por ${visao === 'competencia' ? 'competência' : 'caixa'}?\n\nOs valores do mês ficam guardados como estão: reimportar ou reclassificar não muda mais este mês. Só um administrador reabre.${aviso}`)) return
    gravar({ valores: dre.porMes[mes], extras: dre.extras[mes], fechado_em: new Date().toISOString(), fechado_por: usuarioNome() }, `${rotuloMes(mes)} fechado.`)
  }
  function reabrir() {
    if (!ehAdmin()) { alert('Só um administrador pode abrir o cadeado.'); return }
    if (!window.confirm(`Abrir o cadeado de ${rotuloMes(mes)}? O mês volta a usar os dados importados e a classificação atual.`)) return
    gravar({ valores: null, extras: null, fechado_em: null, fechado_por: null }, `${rotuloMes(mes)} reaberto.`)
  }

  return (
    <div className="card">
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Conferência do mês · {visao === 'competencia' ? 'competência' : 'caixa'}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            {fechado
              ? `🔒 Fechado${info.fechado_por ? ` por ${info.fechado_por}` : ''} em ${new Date(info.fechado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. A conferência abaixo usa os dados atuais.`
              : problemas ? `${problemas} ponto(s) para verificar antes de fechar.` : 'Tudo certo para fechar o mês.'}
          </div>
        </div>
        <select className="form-input" value={mes} onChange={e => setMes(e.target.value)} style={{ width: 130, fontSize: 13 }}>
          {[...meses].reverse().map(m => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        {fechado
          ? <button className="btn btn-ghost btn-sm" onClick={reabrir} disabled={salvando}><LockOpen size={13} /> Abrir cadeado</button>
          : <button className="btn btn-primary btn-sm" onClick={fechar} disabled={salvando}><Lock size={13} /> Fechar mês</button>}
      </div>
      {msg && <div className={`alert-banner ${msg.tipo}`} style={{ margin: 12 }}>{msg.txt}</div>}
      <div style={{ padding: '6px 0' }}>
        {testes.map((t, i) => {
          const aberto = abertos.has(i)
          const temItens = t.itens?.length > 0
          return (
            <div key={i} style={{ padding: '7px 16px', borderTop: i ? '1px solid var(--gray-100)' : 'none' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: temItens ? 'pointer' : 'default' }}
                onClick={() => temItens && setAbertos(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}>
                <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, color: '#fff', background: COR[t.status] }}>{ICONE[t.status]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                    {t.titulo}{temItens && <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}> · {aberto ? 'esconder' : 'ver'}</span>}
                  </div>
                  {t.detalhe && <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{t.detalhe}</div>}
                </div>
              </div>
              {aberto && (
                <ul style={{ margin: '6px 0 0 28px', padding: 0, listStyle: 'none', fontSize: 12, color: 'var(--gray-600)' }}>
                  {t.itens.slice(0, 60).map((it, k) => <li key={k} style={{ padding: '2px 0' }}>{it}</li>)}
                  {t.itens.length > 60 && <li style={{ color: 'var(--gray-400)' }}>… e mais {t.itens.length - 60}</li>}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {visao === 'caixa' && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>Soma dos saldos dos bancos em {rotuloMes(mes)} (último dia):</span>
          <input className="form-input" inputMode="decimal" placeholder="0,00" value={saldoTxt} disabled={fechado}
            onChange={e => setSaldoTxt(e.target.value)} style={{ width: 140, textAlign: 'right', fontSize: 13 }} />
          <button className="btn btn-ghost btn-sm" disabled={salvando || fechado || num(saldoTxt) == null}
            onClick={() => gravar({ saldo_bancos: num(saldoTxt) }, 'Saldo dos bancos salvo.')}><Save size={13} /> Salvar</button>
        </div>
      )}
    </div>
  )
}
