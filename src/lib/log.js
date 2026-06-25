import { supabase } from '../supabase'

function getUsuario() {
  try { return JSON.parse(sessionStorage.getItem('usuario')) } catch { return null }
}

export async function registrarAcao({ acao, descricao, tabela, registroId, dadosAnteriores, dadosNovos }) {
  const u = getUsuario()
  if (!u) return null
  const { data } = await supabase.from('log_acoes').insert({
    usuario_id: u.id,
    usuario_nome: u.nome,
    acao, descricao, tabela,
    registro_id: registroId || null,
    dados_anteriores: dadosAnteriores || null,
    dados_novos: dadosNovos || null,
  }).select().single()
  return data
}

export async function carregarLog(limite = 20) {
  const u = getUsuario()
  if (!u) return []
  const { data } = await supabase
    .from('log_acoes')
    .select('*')
    .eq('usuario_id', u.id)
    .eq('revertido', false)
    .order('criado_em', { ascending: false })
    .limit(limite)
  return data || []
}

export async function reverterAcao(logEntry) {
  const { id, acao, registro_id, dados_anteriores } = logEntry
  try {
    if (acao === 'registro_producao') {
      await supabase.from('producao_diaria').delete().eq('id', registro_id)
    }
    else if (acao === 'registro_producao_lote') {
      const ids = dados_anteriores?.ids || []
      if (ids.length) await supabase.from('producao_diaria').delete().in('id', ids)
    }
    else if (acao === 'ajuste_estoque') {
      await supabase.from('embalagens').update({ estoque_atual: dados_anteriores.estoque_atual }).eq('id', registro_id)
    }
    else if (acao === 'editar_embalagem') {
      await supabase.from('embalagens').update(dados_anteriores).eq('id', registro_id)
    }
    else if (acao === 'planejamento_salvo') {
      await supabase.from('planejamentos').delete().eq('id', registro_id)
    }
    else if (acao === 'pedido_grafica') {
      await supabase.from('pedidos_grafica').delete().eq('id', registro_id)
    }
    else if (acao === 'recebimento') {
      const itens = dados_anteriores?.itens || []
      for (const item of itens) {
        const { data: emb } = await supabase.from('embalagens').select('estoque_atual').eq('id', item.embalagem_id).single()
        if (emb) await supabase.from('embalagens').update({ estoque_atual: Math.max(0, (emb.estoque_atual||0) - item.quantidade_recebida) }).eq('id', item.embalagem_id)
      }
      await supabase.from('recebimentos').delete().eq('id', registro_id)
    }

    await supabase.from('log_acoes').update({ revertido: true, revertido_em: new Date().toISOString() }).eq('id', id)
    return { ok: true }
  } catch(e) {
    return { ok: false, erro: e.message }
  }
}

export function labelAcao(acao) {
  return {
    registro_producao:      '📋 Registro de produção',
    registro_producao_lote: '📋 Lote de produção',
    ajuste_estoque:         '📦 Ajuste de estoque',
    editar_embalagem:       '✏️ Edição de embalagem',
    planejamento_salvo:     '🗓️ Planejamento salvo',
    pedido_grafica:         '🛒 Pedido à gráfica',
    recebimento:            '💰 Recebimento',
  }[acao] || acao
}
