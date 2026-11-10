-- DRE por caixa lançamento a lançamento: extrato de Caixas e Bancos do Bling (todas as contas).
-- Substitui o Balancete (só totais por categoria) nos meses em que o extrato foi importado.
-- Importação: Financeiro › Importar e classificar › Caixa (extrato do Bling).

CREATE TABLE IF NOT EXISTS dre_caixa_lancamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_bling      text UNIQUE,                 -- Id do lançamento no Bling (evita duplicar)
  mes           text NOT NULL,               -- 'AAAA-MM' da data do pagamento/recebimento
  data          date NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('receita', 'despesa', 'transferencia')),
  categoria     text NOT NULL DEFAULT '',
  nome          text NOT NULL DEFAULT '',    -- cliente/fornecedor
  cnpj          text,
  historico     text,
  valor         numeric(14,2) NOT NULL,      -- sempre positivo; o tipo diz se entra ou sai
  banco         text,
  importado_em  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dre_caixa_lancamentos_mes_idx ON dre_caixa_lancamentos (mes);
CREATE INDEX IF NOT EXISTS dre_caixa_lancamentos_data_idx ON dre_caixa_lancamentos (data);

ALTER TABLE dre_caixa_lancamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_caixa_lancamentos;
CREATE POLICY public_all ON dre_caixa_lancamentos FOR ALL USING (true) WITH CHECK (true);

-- Cadeado: mês fechado na DRE por caixa não aceita alteração
DROP TRIGGER IF EXISTS trava_mes ON dre_caixa_lancamentos;
CREATE TRIGGER trava_mes BEFORE INSERT OR UPDATE OR DELETE ON dre_caixa_lancamentos
  FOR EACH ROW EXECUTE FUNCTION trava_mes_dre('caixa');

-- Conferência: deve mostrar RLS ligado e o gatilho do cadeado
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'dre_caixa_lancamentos';
SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'dre_caixa_lancamentos' GROUP BY 1;
