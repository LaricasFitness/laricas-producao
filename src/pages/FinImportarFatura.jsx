import { useState, useRef, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmtR, fmtData } from '../lib/financeiro'
import { Upload, RefreshCw, Save, SkipForward, ChevronLeft, Check, AlertCircle } from 'lucide-react'

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseOFX(texto) {
  const xmlStart = texto.indexOf('<OFX>')
  const xmlPart = xmlStart >= 0 ? texto.slice(xmlStart) : texto
  const stmtBlocks = xmlPart.split(/<STMTTRN>/i).slice(1)
  const transacoes = stmtBlocks.map(block => {
    const getB = tag => { const re = new RegExp(`<${tag}>([^<\n\r]+)`, 'i'); return (block.match(re)?.[1]||'').trim() }
    const dtStr = getB('DTPOSTED').slice(0,8)
    const data = dtStr.length===8 ? `${dtStr.slice(0,4)}-${dtStr.slice(4,6)}-${dtStr.slice(6,8)}` : null
    const valor = Math.abs(parseFloat(getB('TRNAMT').replace(',','.')) || 0)
    const memo = getB('MEMO') || getB('NAME') || ''
    const tipo = getB('TRNTYPE')
    const fitid = getB('FITID')
    return { data, valor, memo, fitid, tipo }
  }).filter(t => t.data && t.valor > 0 && t.tipo !== 'CREDIT')
  const banco = (xmlPart.match(/<ORG>([^<]+)/i)?.[1]||'OFX').trim()
  return { transacoes, banco }
}

function parseInterCSV(texto) {
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  return { banco:'Inter', transacoes: linhas.slice(1).map(linha => {
    const cols = linha.split(';').map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 3) return null
    const [dataRaw,,titulo,desc,valorRaw] = cols
    const m = dataRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!m) return null
    const valor = Math.abs(parseFloat((valorRaw||'0').replace(/\./g,'').replace(',','.')) || 0)
    if (!valor) return null
    return { data:`${m[3]}-${m[2]}-${m[1]}`, valor, memo:desc||titulo||'', fitid:`${dataRaw}-${valor}-${titulo}` }
  }).filter(Boolean) }
}

function parseC6CSV(texto, cartaoFiltro=null) {
  // C6 formato novo: Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)
  const linhas = texto.replace(/^\uFEFF/,'').split('\n').filter(l=>l.trim())
  const header = linhas[0]?.split(';').map(c=>c.trim()) || []
  const idxData  = header.findIndex(h=>h.includes('Data'))
  const idxNome  = header.findIndex(h=>h.includes('Nome'))
  const idxFinal = header.findIndex(h=>h.includes('Final'))
  const idxDesc  = header.findIndex(h=>h.includes('Descri'))
  const idxValorBrl = header.length - 1

  // Extrai cartões disponíveis
  const cartoesMap = {}
  for (const linha of linhas.slice(1)) {
    const cols = linha.split(';').map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 3) continue
    const nome  = idxNome>=0  ? cols[idxNome]  : cols[1]
    const final = idxFinal>=0 ? cols[idxFinal] : cols[2]
    if (!nome) continue
    const key = nome+';'+final
    if (!cartoesMap[key]) cartoesMap[key] = { nome, final, label:nome+' (final '+final+')', count:0 }
    cartoesMap[key].count++
  }
  const cartoes = Object.values(cartoesMap).sort((a,b)=>a.label.localeCompare(b.label))

  const transacoes = linhas.slice(1).map(linha => {
    const cols = linha.split(';').map(c=>c.trim().replace(/^"|"$/g,''))
    if (cols.length < 5) return null
    const dataRaw  = idxData>=0  ? cols[idxData]     : cols[0]
    const nome     = idxNome>=0  ? cols[idxNome]     : cols[1]
    const final    = idxFinal>=0 ? cols[idxFinal]    : cols[2]
    const desc     = idxDesc>=0  ? cols[idxDesc]     : cols[4]
    const valorRaw = cols[idxValorBrl] || cols[cols.length-1]
    if (cartaoFiltro && (nome+';'+final) !== cartaoFiltro) return null
    const m = dataRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (!m) return null
    const data = m[3]+'-'+m[2]+'-'+m[1]
    const valor = parseFloat((valorRaw||'0').replace(/\./g,'').replace(',','.')) || 0
    if (valor <= 0) return null
    return { data, valor, memo:desc||'', cartao:nome+' (final '+final+')', fitid:data+'-'+nome+'-'+final+'-'+valor+'-'+desc }
  }).filter(Boolean)

  return { transacoes, banco:'C6', cartoes }
}

function detectarEParsar(texto, filename, cartaoFiltro=null) {
  const fn = (filename||'').toLowerCase()
  if (fn.endsWith('.ofx') || texto.includes('OFXHEADER') || texto.includes('<OFX>')) {
    const res = parseOFX(texto)
    if (fn.includes('itau') || texto.includes('ITAU')) return {...res, banco:'Itaú', cartoes:[]}
    return {...res, cartoes:[]}
  }
  if (texto.includes('Nome no Cart') || fn.includes('c6')) return parseC6CSV(texto, cartaoFiltro)
  if (texto.includes('Título;Descrição') || fn.includes('inter')) return {...parseInterCSV(texto), cartoes:[]}
  return {...parseOFX(texto), cartoes:[]}
}

// Normaliza memo para matching (remove números, datas, valores)
function normalizarMemo(memo) {
  return memo
    .toUpperCase()
    .replace(/\d{2}\/\d{2}\/?\d{0,4}/g, '') // datas
    .replace(/\*[\w\s]+\*/g, '') // códigos entre asteriscos
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) // limita tamanho
}

// ── Combobox ─────────────────────────────────────────────────────────────────
function ComboboxCat({ value, onChange, opcoes, placeholder='Categoria...' }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const wrapRef = useRef()
  const inputRef = useRef()
  const sel = opcoes.find(o=>o.id===value)
  const filtradas = busca ? opcoes.filter(o=>o.nome.toLowerCase().includes(busca.toLowerCase())) : opcoes

  useEffect(()=>{
    function cl(e){if(wrapRef.current&&!wrapRef.current.contains(e.target)){setAberto(false);setBusca('')}}
    document.addEventListener('mousedown',cl); return ()=>document.removeEventListener('mousedown',cl)
  },[])
  useEffect(()=>{ if(aberto) setTimeout(()=>inputRef.current?.focus(),30) },[aberto])

  return (
    <div ref={wrapRef} style={{position:'relative'}}>
      <div className="form-input" style={{cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',fontSize:13}}
        onClick={()=>setAberto(p=>!p)}>
        <span style={{color:sel?'inherit':'var(--gray-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {sel?sel.nome:placeholder}
        </span>
        <span style={{marginLeft:6,color:'var(--gray-400)',fontSize:11}}>▾</span>
      </div>
      {aberto && (
        <div style={{position:'absolute',top:'calc(100% + 2px)',left:0,right:0,zIndex:100,background:'var(--white)',border:'1px solid var(--gray-200)',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,.15)',overflow:'hidden'}}>
          <input ref={inputRef} className="form-input" style={{border:'none',borderBottom:'1px solid var(--gray-200)',borderRadius:0,fontSize:13}}
            placeholder="Buscar..." value={busca} onChange={e=>setBusca(e.target.value)}/>
          <div style={{maxHeight:180,overflowY:'auto'}}>
            <div onClick={()=>{onChange('');setAberto(false);setBusca('')}} style={{padding:'7px 12px',fontSize:13,cursor:'pointer',color:'var(--gray-400)'}}>— Sem categoria</div>
            {filtradas.map(o=>(
              <div key={o.id} onClick={()=>{onChange(o.id);setAberto(false);setBusca('')}}
                style={{padding:`6px 12px 6px ${12+(o._indent||0)*12}px`,fontSize:13,cursor:'pointer',background:o.id===value?'var(--purple-pale)':'transparent',color:o.id===value?'var(--purple)':'inherit'}}>
                {(o._indent||0)>0?'└ ':''}{o.nome}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function FinImportarFatura() {
  const [step, setStep] = useState('upload') // upload | selecionarCartao | revisar | concluido
  const [banco, setBanco] = useState('')
  const [cartoes, setCartoes] = useState([])
  const [cartaoFiltro, setCartaoFiltro] = useState(null)
  const [textoRaw, setTextoRaw] = useState('')
  const [filenameRaw, setFilenameRaw] = useState('')
  const [itens, setItens] = useState([])
  const [idxAtual, setIdxAtual] = useState(0)
  const [modo, setModo] = useState('lista')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState({salvos:0,pulados:0,total:0})
  const fileRef = useRef()

  // Dados estáticos
  const [categorias, setCategorias] = useState([])
  const [contas, setContas] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [memoMap, setMemoMap] = useState({}) // { pattern: { categoria_id, fornecedor_id, descricao_padrao, conta_id } }

  useEffect(()=>{
    Promise.all([
      supabase.from('fin_categorias').select('*').eq('tipo','despesa').eq('ativo',true).order('nivel').order('ordem').order('nome'),
      supabase.from('fin_contas').select('*').eq('ativo',true).order('nome'),
      supabase.from('fin_fornecedores').select('*').eq('ativo',true).order('razao_social'),
      supabase.from('fin_memo_categorias').select('*'),
    ]).then(([{data:cats},{data:cnts},{data:forns},{data:memos}])=>{
      const todas = cats||[]
      const result = []
      function addN(pid,indent){
        todas.filter(c=>(c.parent_id||null)===(pid||null)).sort((a,b)=>(a.ordem||99)-(b.ordem||99)||(a.nome>b.nome?1:-1))
          .forEach(c=>{ result.push({...c,_indent:indent}); addN(c.id,indent+1) })
      }
      addN(null,0)
      setCategorias(result)
      setContas(cnts||[])
      setFornecedores(forns||[])
      const mm = {}
      for (const m of (memos||[])) mm[m.memo_pattern] = m
      setMemoMap(mm)
    })
  },[])

  function handleFile(file) {
    const reader = new FileReader()
    reader.onload = e => {
      const texto = e.target.result
      setTextoRaw(texto)
      setFilenameRaw(file.name)
      const { transacoes, banco:b, cartoes:cs } = detectarEParsar(texto, file.name)
      setBanco(b)
      if (cs && cs.length > 1) {
        // Múltiplos cartões — mostrar seleção
        setCartoes(cs)
        setCartaoFiltro(null)
        setStep('selecionarCartao')
      } else {
        // Único cartão ou OFX/Inter — vai direto para revisão
        if (!transacoes.length) { alert('Nenhuma transação encontrada.'); return }
        montarItens(transacoes)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  function confirmarCartao(filtro) {
    const { transacoes } = detectarEParsar(textoRaw, filenameRaw, filtro)
    if (!transacoes.length) { alert('Nenhuma transação para este cartão.'); return }
    setCartaoFiltro(filtro)
    montarItens(transacoes)
  }

  function montarItens(transacoes) {
      const novosItens = transacoes.map(t => {
        const pattern = normalizarMemo(t.memo)
        const sugestao = memoMap[pattern]
        return {
          fitid: t.fitid,
          memo_original: t.memo,
          memo_pattern: pattern,
          // Campos editáveis
          descricao: sugestao?.descricao_padrao || t.memo,
          valor: t.valor,
          data: t.data,
          vencimento: t.data,
          competencia: t.data.slice(0,7)+'-01',
          categoria_id: sugestao?.categoria_id || '',
          conta_id: sugestao?.conta_id || contas.find(c=>c.nome?.toLowerCase().includes('c6'))?.id || contas[0]?.id || '',
          fornecedor_id: sugestao?.fornecedor_id || '',
          // Metadados
          auto: !!sugestao,
          confirmado: !!sugestao, // pré-confirmados os que têm sugestão
          pulado: false,
        }
      })
      setItens(novosItens)
      setIdxAtual(novosItens.findIndex(i=>!i.auto) >= 0 ? novosItens.findIndex(i=>!i.auto) : 0)
      setModo('lista')
      setStep('revisar')
  }

  function atualizarItem(idx, campo, valor) {
    setItens(prev => prev.map((it,i) => i===idx ? {...it, [campo]:valor, confirmado: campo==='confirmado'?valor:it.confirmado} : it))
  }

  async function salvarTodos() {
    const parasSalvar = itens.filter(i => i.confirmado && !i.pulado)
    setSalvando(true)
    let salvos = 0
    const usuario = JSON.parse(sessionStorage.getItem('usuario')||'{}').nome

    for (const item of parasSalvar) {
      try {
        const { data: lanc } = await supabase.from('fin_lancamentos').insert({
          tipo: 'despesa',
          descricao: item.descricao || item.memo_original,
          valor_total: parseFloat(item.valor)||0,
          categoria_id: item.categoria_id || null,
          conta_id: item.conta_id || null,
          fornecedor_id: item.fornecedor_id || null,
          total_parcelas: 1,
          criado_por: usuario,
        }).select().single()

        if (lanc) {
          await supabase.from('fin_parcelas').insert({
            lancamento_id: lanc.id,
            numero_parcela: 1,
            valor: parseFloat(item.valor)||0,
            data_vencimento: item.vencimento || item.data,
            data_competencia: item.competencia || null,
            status: 'em_aberto',
            conta_id: item.conta_id || null,
          })
          // Aprende o padrão para próximas faturas
          if (item.memo_pattern) {
            await supabase.from('fin_memo_categorias').upsert({
              memo_pattern: item.memo_pattern,
              categoria_id: item.categoria_id || null,
              fornecedor_id: item.fornecedor_id || null,
              descricao_padrao: item.descricao || null,
              conta_id: item.conta_id || null,
              usos: (memoMap[item.memo_pattern]?.usos||0) + 1,
              atualizado_em: new Date().toISOString(),
            }, { onConflict: 'memo_pattern' })
          }
          salvos++
        }
      } catch(e) { console.error('Erro item:', e.message) }
    }

    setResultado({ salvos, pulados: itens.filter(i=>i.pulado||!i.confirmado).length, total: itens.length })
    setSalvando(false)
    setStep('concluido')
  }

  // ── Seleção de cartão (C6 multi-cartão) ──
  if (step==='selecionarCartao') return (
    <div className="card card-pad">
      <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>💳 Fatura {banco} — Selecione o cartão</div>
      <div style={{fontSize:13,color:'var(--gray-500)',marginBottom:20}}>
        Esta fatura contém lançamentos de múltiplos cartões. Escolha qual deseja importar:
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {cartoes.map(c => {
          const filtro = `${c.nome};${c.final}`
          return (
            <button key={filtro} className="btn btn-ghost"
              style={{justifyContent:'space-between',textAlign:'left',padding:'12px 16px',border:'1px solid var(--gray-200)',borderRadius:8}}
              onClick={()=>confirmarCartao(filtro)}>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>{c.label}</div>
                <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{c.count} lançamentos</div>
              </div>
              <span style={{color:'var(--purple)',fontSize:18}}>→</span>
            </button>
          )
        })}
      </div>
      <button className="btn btn-ghost btn-sm" style={{marginTop:16,color:'var(--gray-400)'}}
        onClick={()=>setStep('upload')}>
        ← Voltar
      </button>
    </div>
  )

  // ── Upload ──
  if (step==='upload') return (
    <div className="card card-pad" style={{textAlign:'center',padding:48}}>
      <div style={{fontSize:40,marginBottom:12}}>💳</div>
      <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Importar Fatura de Cartão</div>
      <div style={{color:'var(--gray-500)',fontSize:13,marginBottom:24,maxWidth:440,margin:'0 auto 24px'}}>
        O sistema reconhece lançamentos que você já categorizou antes e pré-preenche automaticamente. Você só precisa revisar os novos.
      </div>
      <button className="btn btn-primary" onClick={()=>fileRef.current?.click()} style={{fontSize:14,padding:'10px 24px'}}>
        <Upload size={16}/> Escolher arquivo OFX ou CSV
      </button>
      <input ref={fileRef} type="file" accept=".ofx,.ofc,.csv,.txt" style={{display:'none'}}
        onChange={e=>{if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=''}}/>
      <div style={{fontSize:12,color:'var(--gray-400)',marginTop:16}}>Suportado: OFX (C6/Inter/Itaú) · CSV Inter · CSV C6</div>
    </div>
  )

  // ── Concluído ──
  if (step==='concluido') return (
    <div className="card card-pad" style={{textAlign:'center',padding:48}}>
      <div style={{fontSize:40,marginBottom:12}}>✅</div>
      <div style={{fontWeight:800,fontSize:18,marginBottom:6}}>Fatura importada!</div>
      <div style={{fontSize:13,color:'var(--gray-500)',marginBottom:8}}>
        <strong style={{color:'var(--ok)'}}>{resultado.salvos}</strong> lançamentos criados · <strong>{resultado.pulados}</strong> ignorados de {resultado.total} itens ({banco})
      </div>
      <div style={{fontSize:12,color:'var(--purple)',marginBottom:24}}>
        🧠 O sistema aprendeu os padrões e vai pré-preencher automaticamente na próxima fatura.
      </div>
      <button className="btn btn-primary" onClick={()=>{setStep('upload');setItens([])}}>
        Importar outra fatura
      </button>
    </div>
  )

  // ── Revisão ──
  const autoCount = itens.filter(i=>i.auto).length
  const novosCount = itens.filter(i=>!i.auto).length
  const confirmados = itens.filter(i=>i.confirmado&&!i.pulado).length
  const naoRevisados = itens.filter(i=>!i.auto&&!i.confirmado&&!i.pulado).length

  return (
    <div>
      {/* Header com resumo */}
      <div className="card card-pad" style={{marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,marginBottom:4}}>💳 Fatura {banco} — {itens.length} lançamentos</div>
            <div style={{display:'flex',gap:12,fontSize:12}}>
              <span style={{color:'var(--ok)',fontWeight:700}}>✓ {autoCount} reconhecidos automaticamente</span>
              <span style={{color:'var(--gray-500)'}}>·</span>
              <span style={{color:naoRevisados>0?'var(--warning)':'var(--gray-500)',fontWeight:naoRevisados>0?700:400}}>
                {naoRevisados>0?`⚠️ ${naoRevisados} aguardando revisão`:`✓ Todos revisados`}
              </span>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className={`btn btn-sm ${modo==='lista'?'btn-primary':'btn-ghost'}`} onClick={()=>setModo('lista')}>
              📋 Lista
            </button>
            <button className={`btn btn-sm ${modo==='revisar'?'btn-primary':'btn-ghost'}`} onClick={()=>setModo('revisar')}
              disabled={novosCount===0}>
              ✏️ Revisar novos ({naoRevisados})
            </button>
          </div>
        </div>

        {/* Barra de progresso geral */}
        <div style={{marginTop:12,height:6,background:'var(--gray-200)',borderRadius:999,overflow:'hidden'}}>
          <div style={{height:'100%',background:'var(--purple)',width:`${Math.round(confirmados/itens.length*100)}%`,transition:'width .3s',borderRadius:999}}/>
        </div>
        <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>{confirmados} de {itens.length} confirmados</div>
      </div>

      {/* ── MODO LISTA ── */}
      {modo==='lista' && (
        <div className="card" style={{overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--gray-50)'}}>
                <th style={{padding:'8px 14px',textAlign:'left',width:28}}>✓</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Descrição</th>
                <th style={{padding:'8px 14px',textAlign:'left'}}>Categoria</th>
                <th style={{padding:'8px 14px',textAlign:'right',width:100}}>Valor</th>
                <th style={{padding:'8px 14px',textAlign:'center',width:80}}>Data</th>
                <th style={{padding:'8px 14px',width:80}}></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item,i)=>{
                const cat = categorias.find(c=>c.id===item.categoria_id)
                return (
                  <tr key={i} style={{borderTop:'1px solid var(--gray-100)',background:item.pulado?'var(--gray-50)':item.confirmado?'var(--ok-pale)':item.auto?'#f0fdf4':'var(--white)',opacity:item.pulado?.5:1}}>
                    <td style={{padding:'8px 14px',textAlign:'center'}}>
                      {item.pulado ? <span style={{color:'var(--gray-300)'}}>—</span>
                        : item.confirmado ? <span style={{color:'var(--ok)',fontSize:16}}>✓</span>
                        : <span style={{color:'var(--warning)',fontSize:14}}>⚠</span>}
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      <div style={{fontWeight:600}}>{item.descricao||item.memo_original}</div>
                      {item.auto && <div style={{fontSize:10,color:'var(--ok)',marginTop:1}}>🧠 reconhecido automaticamente</div>}
                    </td>
                    <td style={{padding:'8px 14px'}}>
                      {cat ? <span style={{fontSize:12,color:'var(--purple)',fontWeight:600}}>{cat.nome}</span>
                        : <span style={{fontSize:12,color:'var(--gray-300)'}}>Sem categoria</span>}
                    </td>
                    <td style={{padding:'8px 14px',textAlign:'right',fontWeight:700,color:'var(--danger)'}}>
                      - {fmtR(item.valor)}
                    </td>
                    <td style={{padding:'8px 14px',textAlign:'center',fontSize:12,color:'var(--gray-500)'}}>
                      {item.data?.slice(8,10)}/{item.data?.slice(5,7)}
                    </td>
                    <td style={{padding:'8px 10px',textAlign:'right'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>{setIdxAtual(i);setModo('revisar')}} title="Editar">✏️</button>
                        {!item.pulado
                          ? <button className="btn btn-ghost btn-xs" style={{color:'var(--gray-400)'}}
                              onClick={()=>atualizarItem(i,'pulado',true)} title="Ignorar">✕</button>
                          : <button className="btn btn-ghost btn-xs" style={{color:'var(--ok)'}}
                              onClick={()=>atualizarItem(i,'pulado',false)} title="Restaurar">↩</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MODO REVISAR (um a um) ── */}
      {modo==='revisar' && (() => {
        const item = itens[idxAtual]
        if (!item) return null
        const setItem = (campo,valor) => atualizarItem(idxAtual, campo, valor)

        return (
          <div className="card card-pad">
            {/* Navegação */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setIdxAtual(i=>Math.max(0,i-1))} disabled={idxAtual===0}>
                <ChevronLeft size={14}/> Anterior
              </button>
              <span style={{fontSize:13,color:'var(--gray-500)'}}>
                {idxAtual+1} / {itens.length}
                {item.auto && <span style={{color:'var(--ok)',marginLeft:8,fontSize:12}}>🧠 reconhecido</span>}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setIdxAtual(i=>Math.min(itens.length-1,i+1))} disabled={idxAtual===itens.length-1}>
                Próximo →
              </button>
            </div>

            {/* Lançamento original */}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:'var(--gray-50)',borderRadius:8,marginBottom:16}}>
              <div>
                <div style={{fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',fontWeight:700,marginBottom:2}}>Original da fatura</div>
                <div style={{fontWeight:700}}>{item.memo_original}</div>
                <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Data: {fmtData(item.data)}</div>
              </div>
              <div style={{fontWeight:800,fontSize:22,color:'var(--danger)'}}>- {fmtR(item.valor)}</div>
            </div>

            {/* Form */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Descrição no sistema</label>
                <input className="form-input" value={item.descricao||''} onChange={e=>setItem('descricao',e.target.value)}/>
              </div>
              <div className="form-group">
                <label className="form-label">Competência</label>
                <input type="date" className="form-input" value={item.competencia||''} onChange={e=>setItem('competencia',e.target.value)}/>
              </div>
              <div className="form-group">
                <label className="form-label">Vencimento</label>
                <input type="date" className="form-input" value={item.vencimento||''} onChange={e=>setItem('vencimento',e.target.value)}/>
              </div>
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Categoria</label>
                <ComboboxCat value={item.categoria_id||''} onChange={id=>setItem('categoria_id',id)} opcoes={categorias}/>
              </div>
              <div className="form-group">
                <label className="form-label">Conta</label>
                <select className="form-input" value={item.conta_id||''} onChange={e=>setItem('conta_id',e.target.value)}>
                  <option value="">Selecione...</option>
                  {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Fornecedor</label>
                <select className="form-input" value={item.fornecedor_id||''} onChange={e=>setItem('fornecedor_id',e.target.value)}>
                  <option value="">Sem fornecedor</option>
                  {fornecedores.map(f=><option key={f.id} value={f.id}>{f.nome_fantasia||f.razao_social}</option>)}
                </select>
              </div>
            </div>

            {/* Ações do item */}
            <div style={{display:'flex',gap:8,marginTop:16,paddingTop:12,borderTop:'1px solid var(--gray-100)'}}>
              <button className="btn btn-ghost" style={{color:'var(--gray-400)'}}
                onClick={()=>{setItem('pulado',!item.pulado);setItem('confirmado',false)}}>
                {item.pulado?'↩ Restaurar':'✕ Ignorar'}
              </button>
              <div style={{flex:1}}/>
              <button className={`btn ${item.confirmado?'btn-primary':'btn-ghost'}`}
                onClick={()=>{setItem('confirmado',true);if(idxAtual<itens.length-1)setIdxAtual(i=>i+1)}}>
                <Check size={14}/> {item.confirmado?'✓ Confirmado':'Confirmar'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Botão salvar todos */}
      <div style={{marginTop:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:13,color:'var(--gray-500)'}}>
          {confirmados} de {itens.length} confirmados serão lançados
        </div>
        <button className="btn btn-primary" onClick={salvarTodos} disabled={salvando||confirmados===0}
          style={{padding:'10px 24px',fontSize:14}}>
          {salvando?<><RefreshCw size={14} className="spin"/> Salvando...</>:<><Save size={14}/> Lançar {confirmados} {confirmados===1?'item':'itens'}</>}
        </button>
      </div>
    </div>
  )
}
