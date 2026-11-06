-- Produto montado com outro: no planejamento da produção, cada venda dele
-- vira N unidades de outro produto (pelo código/SKU).
-- Ex.: Lets Poke - Pão de Mel Bites Doce de Leite 45g = 1,5 MINI Pão de Mel de Doce de Leite.
-- Tabela já existente (embalagens) — RLS não muda.

ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS planejar_como  text;
ALTER TABLE embalagens ADD COLUMN IF NOT EXISTS planejar_fator numeric(10,3);

UPDATE embalagens
   SET planejar_como = 'MINI_PM_DOCE_DE_LEITE_30', planejar_fator = 1.5
 WHERE codigo = 'LP_BITES_DOCE_DE_LEITE_45';

-- Conferência: deve voltar 1 linha
SELECT codigo, nome, planejar_como, planejar_fator FROM embalagens WHERE planejar_como IS NOT NULL;
