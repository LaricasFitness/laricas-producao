-- Simular campanha: produto pode ficar fora da campanha (ex.: latas, N2).
-- Desativado não recebe quantidade e a meta é redistribuída entre os ativos.

ALTER TABLE campanha_simulada_itens ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
