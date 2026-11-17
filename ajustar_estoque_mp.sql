-- Saldo de matéria-prima somado numa única operação no banco.
-- O front lia o saldo, somava e gravava: duas gravações ao mesmo tempo liam o
-- mesmo valor e uma apagava a outra (NF 37767 salva 2x em 09/11/2026).
-- Usada por src/lib/estoqueMP.js. Pode rodar mais de uma vez.

CREATE OR REPLACE FUNCTION ajustar_estoque_mp(p_id uuid, p_delta numeric)
RETURNS numeric
LANGUAGE sql
AS $$
  UPDATE materias_primas
     SET estoque_atual = COALESCE(estoque_atual, 0) + p_delta,
         atualizado_em = now()
   WHERE id = p_id
  RETURNING estoque_atual;
$$;

GRANT EXECUTE ON FUNCTION ajustar_estoque_mp(uuid, numeric) TO anon, authenticated;
