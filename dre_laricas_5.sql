-- DRE Laricas, parte 5: prova da competência (a partir de nov/26)
-- Lucro por competência = resultado de caixa + variação do que ficou pendente (a receber, estoque, a pagar,
-- carteiras pré-pagas, despesas antecipadas). Cada saldo é conferido por fora, no fim de cada mês; o que sobrar
-- é erro em algum lugar da DRE de competência.
--   item: 'receber:ifood', 'receber:pagarme', ..., 'carteira:lalamove', ..., 'pagar:bling', 'receber:bling'
--   (os de origem 'auto' o sistema calcula e grava; os 'manual' vêm do painel de cada plataforma)

CREATE TABLE IF NOT EXISTS dre_balanco (
  mes     text NOT NULL,
  item    text NOT NULL,
  saldo_ini numeric(14,2),         -- saldo no fim do mês anterior
  saldo   numeric(14,2) NOT NULL,   -- saldo no fim deste mês
  origem  text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'auto')),
  detalhe jsonb,
  por     text,
  em      timestamptz DEFAULT now(),
  PRIMARY KEY (mes, item)
);
ALTER TABLE dre_balanco ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_balanco;
CREATE POLICY public_all ON dre_balanco FOR ALL USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trava_mes ON dre_balanco;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_balanco FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');

-- Correios: vencimento da fatura de cada envio (para saber o que estava a pagar no fim do mês)
ALTER TABLE dre_fretes ADD COLUMN IF NOT EXISTS vencimento date;
