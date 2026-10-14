import { supabase } from '../supabase'
import { atualizarStatusPedido } from './data'
import { mesFechado, avisoMesFechado } from './cmv'

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
      // Deleta o inventário mais recente para essa embalagem (reverte o ponto de referência)
      const { data: invs } = await supabase.from('inventarios')
        .select('id').eq('embalagem_id', registro_id)
        .order('criado_em', { ascending: false }).limit(1)
      if (invs?.length) await supabase.from('inventarios').delete().eq('id', invs[0].id)
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
      const { data: r0 } = await supabase.from('recebimentos').select('data_recebimento').eq('id', registro_id).maybeSingle()
      if (r0 && await mesFechado(r0.data_recebimento)) return { ok: false, erro: avisoMesFechado(r0.data_recebimento) }
      const itens = dados_anteriores?.itens || []
      for (const item of itens) {
        const { data: emb } = await supabase.from('embalagens').select('estoque_atual').eq('id', item.embalagem_id).single()
        if (emb) await supabase.from('embalagens').update({ estoque_atual: Math.max(0, (emb.estoque_atual||0) - item.quantidade_recebida) }).eq('id', item.embalagem_id)
      }
      const { data: rec } = await supabase.from('recebimentos').select('pedido_id').eq('id', registro_id).maybeSingle()
      await supabase.from('recebimentos').delete().eq('id', registro_id)
      // Entrega desfeita: o pedido volta a mostrar o que falta
      if (rec?.pedido_id) await atualizarStatusPedido(rec.pedido_id)
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
