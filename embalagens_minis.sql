-- Embalagens dos minis, do pão de mel 60g e do Lets Poke Bites
-- (a produção é registrada pelo rótulo: o adesivo do sabor, a lata ou a embalagem do Lets Poke já entram por aí)
--   Mini 30g avulso: adesivo MINI do sabor (rótulo) + filme mini + tabela nutricional 30g
--   Pão de mel 60g:  adesivo do sabor (rótulo, o mesmo do mini) + filme 60g + tabela nutricional 60g
--   Lata:            lata (rótulo) + 8 filmes mini, sem adesivo MINI (já é assim, não muda)
--   Lets Poke Bites: embalagem Lets Poke (rótulo) + 1 filme 60g, sem adesivo MINI (6 bites por pacote)
--
-- >>> AJUSTE o custo do Filme 60g antes de rodar (está igual ao de 100g, R$ 0,20) <<<

INSERT INTO embalagens (codigo, nome, categoria, tipo, custo_unitario, ativo, visivel_producao, visivel_estoque, visivel_analise, contagem_semanal, dias_producao, margem_seguranca, unidade_minima_grafica)
SELECT * FROM (VALUES
  ('FILME_PM_60G',      'Filme Pão de Mel 60g',       'Pão de Mel 60g',      'embalagem', 0.20::numeric, true, false, true, true, true,  10, 0.1, 1000),
  ('TABELA_NUTRI_30G',  'Tabela nutricional 30g',     'Mini Pão de Mel 30g', 'embalagem', 0.06,          true, false, true, true, false, 15, 0.1, 1000),
  ('TABELA_NUTRI_60G',  'Tabela nutricional 60g',     'Pão de Mel 60g',      'embalagem', 0.06,          true, false, true, true, false, 15, 0.1, 1000)
) AS v(codigo, nome, categoria, tipo, custo_unitario, ativo, visivel_producao, visivel_estoque, visivel_analise, contagem_semanal, dias_producao, margem_seguranca, unidade_minima_grafica)
WHERE NOT EXISTS (SELECT 1 FROM embalagens e WHERE e.codigo = v.codigo);

-- Mini 30g avulso (os que já têm o filme mini vinculado): + tabela nutricional 30g
INSERT INTO produto_embalagem (sku_produto, embalagem_id, quantidade, observacao)
SELECT pe.sku_produto, (SELECT id FROM embalagens WHERE codigo = 'TABELA_NUTRI_30G'), 1, 'tabela nutricional 30g'
FROM produto_embalagem pe
WHERE pe.sku_produto ~ '^MINI_.*_30$'
  AND pe.embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'FILME_PM_30G')
  AND NOT EXISTS (SELECT 1 FROM produto_embalagem x WHERE x.sku_produto = pe.sku_produto AND x.embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'TABELA_NUTRI_30G'));

-- Pão de mel 60g: filme 100g → filme 60g, + tabela nutricional 60g
UPDATE produto_embalagem SET embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'FILME_PM_60G'), observacao = 'filme 60g'
WHERE sku_produto ~ '^M_.*_60$' AND embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'FILME_PM_100G');
INSERT INTO produto_embalagem (sku_produto, embalagem_id, quantidade, observacao)
SELECT e.codigo, (SELECT id FROM embalagens WHERE codigo = 'TABELA_NUTRI_60G'), 1, 'tabela nutricional 60g'
FROM embalagens e
WHERE e.codigo ~ '^M_.*_60$' AND e.ativo
  AND NOT EXISTS (SELECT 1 FROM produto_embalagem x WHERE x.sku_produto = e.codigo AND x.embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'TABELA_NUTRI_60G'));

-- Lets Poke Bites: filme mini → 1 filme 60g por pacote
UPDATE produto_embalagem SET embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'FILME_PM_60G'), quantidade = 1, observacao = '1 filme 60g por pacote (6 bites)'
WHERE sku_produto = 'LP_BITES_DOCE_DE_LEITE_45' AND embalagem_id = (SELECT id FROM embalagens WHERE codigo = 'FILME_PM_30G');

-- Conferência: deve listar Mini 30g com filme + tabela 30g; 60g com filme 60g + tabela 60g; LP com filme 60g
SELECT pe.sku_produto, e.nome, pe.quantidade, e.custo_unitario
FROM produto_embalagem pe JOIN embalagens e ON e.id = pe.embalagem_id
WHERE pe.sku_produto ~ '^(MINI_|M_|LP_)' ORDER BY 1, 2;
