import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { chamarExpedicao } from './expedicao'

// Conexões com outros sistemas (menu lateral, só admin, acima do usuário). O Bling é testado de verdade
// (o token vale ou renova); os outros só dizem se a chave está configurada na Vercel.
const CONEXOES = [
  { id: 'bling', nome: 'Bling', conectar: '/api/expedicao?acao=conectar' },
  { id: 'shopify', nome: 'Shopify', dica: 'SHOPIFY_LOJA, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET na Vercel' },
  { id: 'mercadopago', nome: 'Mercado Pago', dica: 'MP_ACCESS_TOKEN na Vercel (Mercado Pago › Suas integrações › Credenciais de produção)' },
  { id: 'melhorenvio', nome: 'Melhor Envio', dica: 'MELHORENVIO_TOKEN na Vercel (Melhor Envio › Integrações › Permissões de acesso)' },
  { id: 'lalamove', nome: 'Lalamove', dica: 'LALAMOVE_API_KEY e LALAMOVE_API_SECRET na Vercel (Partner Portal)' },
]

export default function Conexoes() {
  const [st, setSt] = useState(null)
  const [erro, setErro] = useState(false)
  const [carregando, setCarregando] = useState(false)
  async function ver() {
    setCarregando(true)
    try { setSt(await chamarExpedicao('status')); setErro(false) } catch { setErro(true) }
    setCarregando(false)
  }
  useEffect(() => { ver(); const t = setInterval(ver, 15 * 60000); return () => clearInterval(t) }, [])
  return (
    <div className="sidebar-conexoes">
      <div className="conexoes-titulo">Conexões
        <button className="icon-btn" onClick={ver} title="Verificar de novo" disabled={carregando}><RefreshCw size={12} className={carregando ? 'spin' : ''} /></button>
      </div>
      {erro && <div className="conexao-linha"><span className="conexao-ponto" style={{ background: '#e8a33d' }} />não consegui verificar</div>}
      {st && CONEXOES.map(c => {
        const ok = !!st[c.id]
        return <div key={c.id} className="conexao-linha" title={ok ? 'Conectado' : c.dica || 'Desconectado'}>
          <span className="conexao-ponto" style={{ background: ok ? '#4caf7a' : '#e05a5a' }} />
          <span style={{ flex: 1 }}>{c.nome}</span>
          {c.conectar && <a className="conexao-btn" href={c.conectar}>{ok ? 'reconectar' : 'conectar'}</a>}
          {!c.conectar && !ok && <span className="conexao-falta">sem chave</span>}
        </div>
      })}
    </div>
  )
}
