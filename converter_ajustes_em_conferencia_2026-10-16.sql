-- 16/10/2026, 14:47–14:55: a contagem física de 9 insumos foi lançada na aba
-- Situação ("inventário" em mp_inventarios) em vez de Conferência. O saldo
-- (materias_primas.estoque_atual) já está no valor contado — não muda aqui.
-- O que este script faz: transforma esses 9 registros em conferências
-- (conferencia_mp), com o saldo que o sistema tinha antes e a diferença,
-- e apaga os registros de "inventário" para não duplicar a contagem.
--
-- Saldo "sistema" antes da edição, reconstruído: última conferência
-- (09/10/2026) + compras depois dela − consumo registrado até a hora da
-- edição. É uma estimativa fiel enquanto o saldo só tiver mudado por
-- compras e produção nesse período.

BEGIN;

WITH ed AS (
  SELECT i.id, i.materia_prima_id AS mp, i.quantidade AS contado, i.criado_em AS ts_ed
  FROM mp_inventarios i
  WHERE i.id IN (
    'e8d1bbf5-743f-449a-a695-c418b40fb59f',  -- Cobertura chocolate ao leite (pacote 2kg)
    'bfdec9b3-44ee-4577-afe5-d7cb022e59b6',  -- Cobertura chocolate branco (pacote 2kg)
    '4a546799-79a1-4b2e-bfbb-ee8cef6ccf5f',  -- Barra chocolate ao leite
    'b448d730-3e1a-47b7-9f5c-20e7e0d3fd48',  -- Barra chocolate branco
    '4b1acc45-0d16-49e4-bb6c-c9cc1f7c0337',  -- Whey Protein Concentrado Chocolate
    'fb04a042-0150-41a7-9cb1-4a273dbf0848',  -- Whey Protein Concentrado Doce de Leite
    'fbbba22f-0648-4164-a3f1-520f119579eb',  -- Whey Protein Concentrado Baunilha
    '64baa44b-8b4d-40cb-a5dd-c5bd6f9ceec9',  -- Leite em pó integral
    'a69a7ae8-cc59-405f-b09b-9c169713111b'   -- Doce Leite Puro - zero açucar
  )
),
cont AS (
  SELECT materia_prima_id AS mp, data_conferencia AS d, estoque_contado AS q, criado_em AS ts FROM conferencia_mp
  UNION ALL
  SELECT materia_prima_id, data_inventario, quantidade, criado_em FROM mp_inventarios WHERE id NOT IN (SELECT id FROM ed)
),
base AS (
  SELECT DISTINCT ON (e.id) e.id, c.d, c.q, c.ts
  FROM ed e JOIN cont c ON c.mp = e.mp AND c.ts < e.ts_ed
  ORDER BY e.id, c.d DESC, c.ts DESC
),
calc AS (
  SELECT e.id, e.mp, e.contado, e.ts_ed,
    ROUND(b.q
      + COALESCE((SELECT SUM(quantidade) FROM mp_compras c
                  WHERE c.materia_prima_id = e.mp AND c.data_compra > b.d AND c.criado_em < e.ts_ed), 0)
      - COALESCE((SELECT SUM(quantidade) FROM mp_consumos x
                  WHERE x.materia_prima_id = e.mp AND x.criado_em < e.ts_ed
                    AND (x.data_consumo > b.d OR (x.data_consumo = b.d AND x.criado_em > b.ts))), 0), 3) AS sistema
  FROM ed e JOIN base b ON b.id = e.id
)
INSERT INTO conferencia_mp (materia_prima_id, data_conferencia, estoque_sistema, estoque_contado,
                            custo_unitario, responsavel, observacao, criado_em)
SELECT c.mp, '2026-10-16', c.sistema, c.contado, m.custo_unitario, 'Virgínia',
       'Conferência física — sistema: ' || c.sistema || ', contado: ' || c.contado ||
       ' (lançada na Situação por engano e convertida; sistema reconstruído: conferência de 09/10 + compras − consumo)',
       c.ts_ed
FROM calc c JOIN materias_primas m ON m.id = c.mp
WHERE NOT EXISTS (   -- seguro rodar duas vezes
  SELECT 1 FROM conferencia_mp x WHERE x.materia_prima_id = c.mp AND x.criado_em = c.ts_ed
);

DELETE FROM mp_inventarios WHERE id IN (
  'e8d1bbf5-743f-449a-a695-c418b40fb59f', 'bfdec9b3-44ee-4577-afe5-d7cb022e59b6',
  '4a546799-79a1-4b2e-bfbb-ee8cef6ccf5f', 'b448d730-3e1a-47b7-9f5c-20e7e0d3fd48',
  '4b1acc45-0d16-49e4-bb6c-c9cc1f7c0337', 'fb04a042-0150-41a7-9cb1-4a273dbf0848',
  'fbbba22f-0648-4164-a3f1-520f119579eb', '64baa44b-8b4d-40cb-a5dd-c5bd6f9ceec9',
  'a69a7ae8-cc59-405f-b09b-9c169713111b'
);

-- Conferência: devem aparecer 9 linhas de hoje, com sistema, contado e diferença
SELECT m.nome, c.estoque_sistema, c.estoque_contado, c.diferenca,
       ROUND(c.diferenca * c.custo_unitario, 2) AS diferenca_rs
FROM conferencia_mp c JOIN materias_primas m ON m.id = c.materia_prima_id
WHERE c.data_conferencia = '2026-10-16' ORDER BY m.nome;

COMMIT;
