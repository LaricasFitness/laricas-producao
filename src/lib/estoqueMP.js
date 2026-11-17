import { useRef } from 'react'
import { supabase } from '../supabase'

// Soma (ou subtrai) no saldo de uma matéria-prima numa única operação no banco
// (função ajustar_estoque_mp, arquivo ajustar_estoque_mp.sql).
//
// Ler o saldo, somar no navegador e gravar perde lançamentos quando duas
// gravações correm juntas: as duas leem o mesmo saldo e a segunda apaga a
// primeira. Foi o que aconteceu com a NF 37767 (salva duas vezes ao mesmo
// tempo em 09/11/2026): as compras entraram em dobro, o saldo só somou uma vez,
// e a exclusão da cópia deixou Mel, Fermento, Bicarbonato e outros negativos.
//
// Sem truncar em zero: negativo sinaliza compra não lançada ou consumo a maior.
export async function somarEstoqueMP(mpId, delta) {
  if (!mpId || !delta) return
  const { error } = await supabase.rpc('ajustar_estoque_mp', { p_id: mpId, p_delta: delta })
  if (!error) return
  // Função ainda não criada no banco: cai no jeito antigo para não travar a operação
  if (error.code !== 'PGRST202') throw error
  const { data: mp } = await supabase.from('materias_primas').select('estoque_atual').eq('id', mpId).single()
  const novo = (parseFloat(mp?.estoque_atual) || 0) + delta
  await supabase.from('materias_primas')
    .update({ estoque_atual: novo, atualizado_em: new Date().toISOString() })
    .eq('id', mpId)
}

// Impede que um clique duplo rode a mesma gravação duas vezes ao mesmo tempo.
// Uso: const umaVez = useUmaVez();  onClick={umaVez(salvar)}
export function useUmaVez() {
  const rodando = useRef(false)
  return fn => async (...args) => {
    if (rodando.current) return
    rodando.current = true
    try { return await fn(...args) } finally { rodando.current = false }
  }
}
