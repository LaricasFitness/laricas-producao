-- Estoque de embalagem e rótulo igual ao da matéria-prima (novembro/2026).
-- Aplicar ANTES de publicar o código desta mudança. Pode rodar de novo sem problema.
-- Só colunas novas em tabelas que já existem (as políticas RLS delas continuam valendo).

-- 1) Compra de embalagem lançada depois de uma contagem, com nota de data até ela:
--    "já estava na contagem?" — false = não soma ao saldo (como mp_compras.entrou_no_saldo)
ALTER TABLE recebimento_itens ADD COLUMN IF NOT EXISTS entrou_no_saldo boolean NOT NULL DEFAULT true;

--    O saldo da embalagem passa a usar a regra da matéria-prima (compra lançada depois da contagem
--    soma). A regra antiga usava a data da nota: nota com data anterior à contagem não somava.
--    Para o saldo de hoje não mudar, essas compras antigas ficam marcadas como "já estava na contagem".
--    Em 23/11/2026 eram 4 itens: embalagens de Chocotone (100 de cada sabor, nota de 02/11, lançadas
--    depois da contagem de 23/11). Só mexe no que foi lançado até hoje.
UPDATE recebimento_itens ri SET entrou_no_saldo = false
FROM recebimentos r
WHERE r.id = ri.recebimento_id
  AND r.criado_em < '2026-11-24'
  AND ri.entrou_no_saldo
  AND EXISTS (SELECT 1 FROM inventarios i
              WHERE i.embalagem_id = ri.embalagem_id
                AND i.criado_em < r.criado_em
                AND r.data_recebimento < i.data_inventario);

-- 2) Custo da embalagem congelado na data da contagem (como conferencia_mp.custo_unitario).
--    Conferências antigas ficam sem: a tela usa o custo atual para elas.
ALTER TABLE conferencia_estoque ADD COLUMN IF NOT EXISTS custo_unitario numeric(12,4);

-- 3) Itens da contagem da semana (⭐ na tela de Conferência)
ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS contagem_semanal boolean NOT NULL DEFAULT false;
ALTER TABLE embalagens      ADD COLUMN IF NOT EXISTS contagem_semanal boolean NOT NULL DEFAULT false;

--    Sugestão inicial: os itens que somam ~80% do valor consumido nos últimos 90 dias (curva A).
--    Só marca se ainda não houver nenhum marcado (rodar de novo não desfaz o que foi ajustado na tela).
WITH c AS (
  SELECT m.id, SUM(c.quantidade) * MAX(m.custo_unitario) AS valor
  FROM mp_consumos c JOIN materias_primas m ON m.id = c.materia_prima_id
  WHERE c.data_consumo >= CURRENT_DATE - 90 AND m.ativo
  GROUP BY m.id
), r AS (
  SELECT id, SUM(valor) OVER (ORDER BY valor DESC) - valor AS antes, SUM(valor) OVER () AS total
  FROM c WHERE valor > 0
)
UPDATE materias_primas SET contagem_semanal = true
WHERE id IN (SELECT id FROM r WHERE antes < 0.8 * total)
  AND NOT EXISTS (SELECT 1 FROM materias_primas WHERE contagem_semanal);

WITH c AS (
  SELECT e.id, SUM(p.quantidade) * MAX(e.custo_unitario) AS valor
  FROM producao_diaria p JOIN embalagens e ON e.id = p.embalagem_id
  WHERE p.data_producao >= CURRENT_DATE - 90 AND e.ativo
  GROUP BY e.id
), r AS (
  SELECT id, SUM(valor) OVER (ORDER BY valor DESC) - valor AS antes, SUM(valor) OVER () AS total
  FROM c WHERE valor > 0
)
UPDATE embalagens SET contagem_semanal = true
WHERE id IN (SELECT id FROM r WHERE antes < 0.8 * total)
  AND NOT EXISTS (SELECT 1 FROM embalagens WHERE contagem_semanal);

-- Conferência: quantos ficaram marcados
SELECT 'materias_primas' AS tabela, COUNT(*) FILTER (WHERE contagem_semanal) AS semanais FROM materias_primas WHERE ativo
UNION ALL
SELECT 'embalagens', COUNT(*) FILTER (WHERE contagem_semanal) FROM embalagens WHERE ativo;
