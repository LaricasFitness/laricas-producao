-- Lets Poke - Pão de Mel Bites Doce de Leite 45g (LP_BITES_DOCE_DE_LEITE_45)
-- Cada unidade = 1 rótulo próprio (R$ 0,80) + 1 Filme Mini Pão de Mel 30g
--              + recheio/massa/cobertura de 1,5 MINI Doce de Leite (ficha × 1,5 = 45 g).
-- Só dados em tabelas existentes — RLS não muda. Pode rodar mais de uma vez.

-- 1. Custo do rótulo próprio
UPDATE embalagens SET custo_unitario = 0.80
 WHERE codigo = 'LP_BITES_DOCE_DE_LEITE_45';

-- 2. Filme: 1 Filme Mini Pão de Mel 30g por unidade (vínculo por produto)
INSERT INTO produto_embalagem (sku_produto, embalagem_id, quantidade)
SELECT 'LP_BITES_DOCE_DE_LEITE_45', e.id, 1
  FROM embalagens e
 WHERE e.nome = 'Filme Mini Pão de Mel 30g'
   AND NOT EXISTS (SELECT 1 FROM produto_embalagem pe
                    WHERE pe.sku_produto = 'LP_BITES_DOCE_DE_LEITE_45' AND pe.embalagem_id = e.id);

-- 3. Ficha técnica: a do MINI Doce de Leite × 1,5
--    (Massa 12→18 g, Recheio Doce de Leite 9→13,5 g, Cobertura ao Leite 9→13,5 g)
INSERT INTO produto_composicao (sku_produto, preparacao_id, quantidade_por_unidade, unidade)
SELECT 'LP_BITES_DOCE_DE_LEITE_45', pc.preparacao_id, pc.quantidade_por_unidade * 1.5, pc.unidade
  FROM produto_composicao pc
 WHERE pc.sku_produto = 'MINI_PM_DOCE_DE_LEITE_30'
   AND NOT EXISTS (SELECT 1 FROM produto_composicao x WHERE x.sku_produto = 'LP_BITES_DOCE_DE_LEITE_45');

-- Conferência: custo 0,80 · 1 filme · 3 preparações somando 45 g
SELECT e.custo_unitario,
       (SELECT count(*) FROM produto_embalagem WHERE sku_produto = e.codigo) AS filmes,
       (SELECT sum(quantidade_por_unidade) FROM produto_composicao WHERE sku_produto = e.codigo) AS gramas_ficha
  FROM embalagens e WHERE e.codigo = 'LP_BITES_DOCE_DE_LEITE_45';
