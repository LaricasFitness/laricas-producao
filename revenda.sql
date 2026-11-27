-- Mercadoria para revenda (comprada pronta): Wafer.
-- 1) A Wafer vira item de estoque (materias_primas, categoria "Mercadoria para revenda", em unidades): compra pelo
--    lançamento de compra da matéria-prima (display com 12 un) e contagem em Estoque › Produtos prontos (revenda).
-- 2) Conta própria no CMV da DRE: fecha pelo estoque (inicial + compras − contagem do fim do mês), como a matéria-prima.
-- 3) Regra: a categoria do Bling "CMV - Mercadoria para Revenda" vai para essa conta (as contas a pagar só entram no
--    caixa; na competência vale o fechamento do estoque, como na matéria-prima).
-- Sem tabela nova (as tabelas usadas já têm RLS). Pode rodar mais de uma vez.

INSERT INTO materias_primas (nome, categoria, unidade, custo_unitario, estoque_atual, estoque_minimo, fornecedor, observacao, ativo)
SELECT 'Wafer', 'Mercadoria para revenda', 'un', 0, 0, 0, 'MM Produtos Alimenticios Ltda',
       'Comprada pronta para revender. Display com 12 unidades. Contagem em Estoque › Produtos prontos (revenda).', true
WHERE NOT EXISTS (SELECT 1 FROM materias_primas WHERE categoria = 'Mercadoria para revenda' AND nome ILIKE 'wafer%');

INSERT INTO dre_plano (id, grupo, nome, ordem, so_caixa, cmo, ativo)
VALUES ('cmv.revenda', 'cmv', 'Mercadoria para revenda (fechamento de estoque)', 15, true, false, true)
ON CONFLICT (id) DO UPDATE SET grupo = EXCLUDED.grupo, nome = EXCLUDED.nome, ordem = EXCLUDED.ordem, so_caixa = EXCLUDED.so_caixa, ativo = true;

INSERT INTO dre_regras (categoria, fornecedor, conta, so_caixa)
SELECT 'CMV - Mercadoria para Revenda', NULL, 'cmv.revenda', false
WHERE NOT EXISTS (SELECT 1 FROM dre_regras WHERE categoria = 'CMV - Mercadoria para Revenda' AND fornecedor IS NULL);
