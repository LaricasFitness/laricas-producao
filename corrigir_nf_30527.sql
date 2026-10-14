-- Corrige a NF 30527 (IBÉRICA, 22/09/2026) conforme a nota física:
--   Bicarbonato 2 kg R$ 19,88 · Coco flocos 1 kg R$ 42,95 · Coco médio 1 kg R$ 46,77
--   Eritritol 10 kg R$ 184,90 · Leite em pó 25 kg R$ 1.012,00 · total R$ 1.306,50
--
-- Não mexe em materias_primas.estoque_atual: a contagem de 30/09 é posterior
-- à compra e já refletiu o físico (mesma regra do app desde o commit 9fa4cb0).

BEGIN;

-- 1) Remove as 3 cópias lançadas em 28/09
DELETE FROM mp_compras
WHERE id IN (
  'eec0c391-441c-435f-8e95-f8a5f2538ace',  -- Bicarbonato (cópia)
  '226fce97-5eb2-4651-80ff-5b6037aa9b95',  -- Coco médio (cópia)
  '960d0157-0a4e-4888-a979-94af7f404ba1'   -- Leite em pó integral (cópia)
);

-- 2) Eritritol: 184,00 → 184,90 (custo_unitario da compra é calculado pelo banco)
UPDATE mp_compras SET custo_total = 184.90
WHERE id = '3e1a5321-7350-47d9-8aa9-1bf10ec02456';

-- 3) Preço médio das 4 MPs, mesma regra de recalcularCustoMP():
--    média ponderada dos últimos 30 dias; sem compra na janela, todo o histórico
UPDATE materias_primas m
SET custo_unitario = s.preco, atualizado_em = now()
FROM (
  SELECT mp.id,
         COALESCE(
           (SELECT SUM(custo_total) / NULLIF(SUM(quantidade), 0) FROM mp_compras c
             WHERE c.materia_prima_id = mp.id AND c.data_compra >= current_date - 30),
           (SELECT SUM(custo_total) / NULLIF(SUM(quantidade), 0) FROM mp_compras c
             WHERE c.materia_prima_id = mp.id)
         ) AS preco
  FROM materias_primas mp
  WHERE mp.id IN (SELECT materia_prima_id FROM mp_compras
                  WHERE id = '3e1a5321-7350-47d9-8aa9-1bf10ec02456'
                     OR (numero_nf = '30527' AND data_compra = '2026-09-22'))
) s
WHERE s.id = m.id AND s.preco > 0;

-- Conferência: deve listar 5 linhas somando 1306.50
SELECT m.nome, c.quantidade, c.custo_total
FROM mp_compras c JOIN materias_primas m ON m.id = c.materia_prima_id
WHERE c.numero_nf = '30527' ORDER BY m.nome;

COMMIT;
