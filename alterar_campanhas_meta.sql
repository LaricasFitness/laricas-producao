-- Simular campanha: troca "dias × volume" por meta de faturamento.
-- A tabela ainda não tem simulações salvas, então nada se perde.

ALTER TABLE campanhas_simuladas DROP COLUMN IF EXISTS dias;
ALTER TABLE campanhas_simuladas DROP COLUMN IF EXISTS multiplicador;
ALTER TABLE campanhas_simuladas ADD COLUMN IF NOT EXISTS meta_faturamento numeric;  -- R$, já com desconto
