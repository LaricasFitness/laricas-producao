-- DRE por competência: faturamento do site vindo da Shopify (canal 'Site' → linha Venda Site).
-- Só libera a origem 'shopify' na tabela das plataformas; os lançamentos são feitos pelo sistema
-- (Financeiro › Importar e classificar › Faturamento das plataformas › "Site: buscar na Shopify").

ALTER TABLE dre_canal_competencia DROP CONSTRAINT IF EXISTS dre_canal_competencia_origem_check;
ALTER TABLE dre_canal_competencia ADD CONSTRAINT dre_canal_competencia_origem_check
  CHECK (origem IN ('print', 'digitado', 'portal', 'planilha', 'shopify'));

-- Conferência: deve listar a regra com 'shopify'
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'dre_canal_competencia_origem_check';
