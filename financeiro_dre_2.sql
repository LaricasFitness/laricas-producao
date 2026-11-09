-- Financeiro › DRE — parte 2: datas do lançamento, conferência e cadeado do mês.
-- 1 tabela nova (dre_mes) com RLS; colunas novas em tabela existente. Pode rodar mais de uma vez.

-- 1. Datas completas de cada conta (vêm do relatório do Bling quando as colunas existem)
ALTER TABLE dre_contas_competencia ADD COLUMN IF NOT EXISTS vencimento date;
ALTER TABLE dre_contas_competencia ADD COLUMN IF NOT EXISTS data_baixa date;

-- 2. Mês da DRE: saldo dos bancos (conferência do caixa) e cadeado.
--    Ao fechar, os valores das linhas ficam guardados (valores/extras): reclassificar
--    categoria ou reimportar não muda mais um mês fechado.
CREATE TABLE IF NOT EXISTS dre_mes (
  mes                text NOT NULL,                    -- 'AAAA-MM'
  visao              text NOT NULL CHECK (visao IN ('competencia', 'caixa')),
  saldo_final_bling  numeric(14,2),                    -- saldo final do Balancete importado
  saldo_bancos       numeric(14,2),                    -- soma dos extratos no último dia do mês
  valores            jsonb,
  extras             jsonb,
  fechado_em         timestamptz,
  fechado_por        text,
  atualizado_em      timestamptz DEFAULT now(),
  PRIMARY KEY (mes, visao)
);
ALTER TABLE dre_mes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_mes;
CREATE POLICY public_all ON dre_mes FOR ALL USING (true) WITH CHECK (true);

-- 3. Trava no banco: mês fechado não aceita importação nem receita nova
CREATE OR REPLACE FUNCTION trava_mes_dre() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v text := TG_ARGV[0];
  m_old text;
  m_new text;
BEGIN
  IF TG_TABLE_NAME = 'dre_contas_competencia' THEN
    m_old := to_char(OLD.competencia, 'YYYY-MM');
    m_new := to_char(NEW.competencia, 'YYYY-MM');
  ELSE
    m_old := OLD.mes;
    m_new := NEW.mes;
  END IF;
  IF EXISTS (SELECT 1 FROM dre_mes d
              WHERE d.visao = v AND d.fechado_em IS NOT NULL AND d.mes IN (m_old, m_new)) THEN
    RAISE EXCEPTION 'Mês % fechado na DRE (cadeado): abra o cadeado antes de alterar.', coalesce(m_new, m_old);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trava_mes ON dre_contas_competencia;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_contas_competencia
  FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');
DROP TRIGGER IF EXISTS trava_mes ON dre_receita_competencia;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_receita_competencia
  FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('competencia');
DROP TRIGGER IF EXISTS trava_mes ON dre_caixa;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_caixa
  FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('caixa');

-- 4. Embalagem de envio passa a ser custo dos produtos (linha própria)
UPDATE dre_mapa SET linha = 'cmv_envio', atualizado_em = now()
 WHERE origem = 'competencia' AND nome = 'SALUTE INDUSTRIA DE PAPELAO ONDULADO LTDA';

-- Conferência: tabela com RLS e 3 gatilhos
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'dre_mes';
SELECT event_object_table, trigger_name FROM information_schema.triggers
 WHERE trigger_name = 'trava_mes' GROUP BY 1, 2;
