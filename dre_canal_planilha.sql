-- DRE › Faturamento das plataformas: aceita lançamentos importados de planilha (99 Food).
-- Só amplia a lista de origens permitidas. Pode rodar mais de uma vez.
ALTER TABLE dre_canal_competencia DROP CONSTRAINT IF EXISTS dre_canal_competencia_origem_check;
ALTER TABLE dre_canal_competencia ADD CONSTRAINT dre_canal_competencia_origem_check
  CHECK (origem IN ('print', 'digitado', 'portal', 'planilha'));

-- Conferência
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'dre_canal_competencia_origem_check';
