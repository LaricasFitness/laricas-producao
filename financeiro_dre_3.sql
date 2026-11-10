-- Financeiro › DRE — parte 3: faturamento das plataformas de delivery (iFood, 99 Food, Keeta, Anota.AI)
-- por canal e unidade, na competência. 1 tabela nova com RLS. Pode rodar mais de uma vez.
--
-- Cada linha é o fechamento do mês de uma loja numa plataforma (o "Faturamento" do portal):
--   vendas      → Receita bruta · Delivery
--   promocoes   → Deduções · Descontos e promoções
--   taxas + servicos − ajustes → Despesas variáveis · Comercial (comissão e taxas)
-- total_faturamento é o "Total do faturamento" do portal, só para conferir a leitura.

CREATE TABLE IF NOT EXISTS dre_canal_competencia (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes                text NOT NULL,                    -- 'AAAA-MM'
  canal              text NOT NULL,                    -- 'iFood', '99 Food', 'Keeta', 'Anota.AI'…
  unidade            text NOT NULL DEFAULT '',         -- 'BV', 'ZN', 'BK', 'PR'…
  vendas             numeric(14,2) NOT NULL DEFAULT 0, -- valor das vendas (bruto)
  promocoes          numeric(14,2) NOT NULL DEFAULT 0, -- promoções pagas pela loja
  taxas              numeric(14,2) NOT NULL DEFAULT 0, -- taxas e comissões
  servicos           numeric(14,2) NOT NULL DEFAULT 0, -- serviços contratados (ex.: entrega sob demanda)
  ajustes            numeric(14,2) NOT NULL DEFAULT 0, -- + a favor da loja (reembolsos), − contra
  total_faturamento  numeric(14,2),                    -- total do portal, para conferência
  unidade_print      text,                             -- nome da loja como aparece no print
  detalhes           jsonb,                            -- linhas lidas do print
  origem             text NOT NULL DEFAULT 'digitado' CHECK (origem IN ('print', 'digitado')),
  atualizado_em      timestamptz DEFAULT now(),
  atualizado_por     text,
  UNIQUE (mes, canal, unidade)
);

ALTER TABLE dre_canal_competencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_canal_competencia;
CREATE POLICY public_all ON dre_canal_competencia FOR ALL USING (true) WITH CHECK (true);

-- Mês fechado (cadeado) não aceita lançamento novo (mesma trava das outras tabelas da DRE)
DROP TRIGGER IF EXISTS trava_mes ON dre_canal_competencia;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_canal_competencia
  FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');

-- Conferência: tabela com RLS e gatilho
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'dre_canal_competencia';
SELECT event_object_table, trigger_name FROM information_schema.triggers
 WHERE event_object_table = 'dre_canal_competencia' GROUP BY 1, 2;
