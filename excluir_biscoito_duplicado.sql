-- RODAR SÓ DEPOIS DE CONFERIR A NF 74478 (Biscoito Dark Vanilla, 4,2 kg).
-- Existem dois lançamentos da mesma nota:
--   A) NF 000074478, data 30/09, R$ 309,05 (foto da NF) — NÃO somou ao estoque
--   B) NF 74478,     data 26/10, R$ 317,87 (manual)     — somou ao estoque
-- Este script apaga o A e mantém o B. O estoque não muda.
-- Se o valor certo da nota for R$ 309,05, corrija o B na tela depois de rodar.

BEGIN;

DELETE FROM mp_compras WHERE id = 'a986da5d-7b4f-451a-a9aa-30b6d1f9c1a1';

-- Preço médio, mesma regra de recalcularCustoMP(): 30 dias; sem compra, todo o histórico
UPDATE materias_primas m
SET custo_unitario = s.preco, atualizado_em = now()
FROM (
  SELECT mp.id, COALESCE(
    (SELECT SUM(custo_total) / NULLIF(SUM(quantidade), 0) FROM mp_compras c
      WHERE c.materia_prima_id = mp.id AND c.data_compra >= current_date - 30),
    (SELECT SUM(custo_total) / NULLIF(SUM(quantidade), 0) FROM mp_compras c
      WHERE c.materia_prima_id = mp.id)) AS preco
  FROM materias_primas mp WHERE mp.nome = 'Biscoito Dark Vanilla'
) s
WHERE s.id = m.id AND s.preco > 0;

COMMIT;
