-- Financeiro › DRE: competência e caixa a partir das exportações do Bling.
--   • Competência (despesas): relatório "Contas a pagar por competência" (CSV)
--   • Caixa: relatório "Balancete" do mês (CSV)
--   • Receita por competência: digitada na tela (o Bling não tem essa visão)
-- 4 tabelas novas, todas com RLS (mesmo padrão public_all das demais tabelas).
-- Pode rodar mais de uma vez.

-- 1. Contas a pagar por competência (cada importação substitui os meses do arquivo)
CREATE TABLE IF NOT EXISTS dre_contas_competencia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia     date NOT NULL,
  vencimento_mes  text,
  nome            text,
  categoria       text,
  observacoes     text,
  valor           numeric(14,2) NOT NULL,
  situacao        text,
  importado_em    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dre_contas_competencia_comp_idx ON dre_contas_competencia (competencia);

-- 2. Balancete (caixa): total do mês por categoria principal
CREATE TABLE IF NOT EXISTS dre_caixa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mes           text NOT NULL,              -- 'AAAA-MM'
  tipo          text NOT NULL CHECK (tipo IN ('receita', 'despesa', 'transferencia')),
  categoria     text NOT NULL,
  valor         numeric(14,2) NOT NULL,
  importado_em  timestamptz DEFAULT now(),
  UNIQUE (mes, tipo, categoria)
);

-- 3. Receita por competência, digitada por linha da DRE
CREATE TABLE IF NOT EXISTS dre_receita_competencia (
  mes             text NOT NULL,            -- 'AAAA-MM'
  linha           text NOT NULL,            -- id da linha da DRE (ex.: rec_delivery)
  valor           numeric(14,2) NOT NULL DEFAULT 0,
  atualizado_em   timestamptz DEFAULT now(),
  atualizado_por  text,
  PRIMARY KEY (mes, linha)
);

-- 4. Classificação: categoria do Bling (+ fornecedor, quando a categoria é ambígua) → linha da DRE.
--    As categorias comuns já vêm classificadas no código; aqui ficam as escolhas feitas na tela.
CREATE TABLE IF NOT EXISTS dre_mapa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem         text NOT NULL CHECK (origem IN ('competencia', 'caixa_receita', 'caixa_despesa')),
  categoria      text NOT NULL,
  nome           text NOT NULL DEFAULT '',  -- '' = vale para a categoria toda
  linha          text NOT NULL,
  atualizado_em  timestamptz DEFAULT now(),
  UNIQUE (origem, categoria, nome)
);

-- RLS
ALTER TABLE dre_contas_competencia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_caixa               ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_receita_competencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_mapa                ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_all ON dre_contas_competencia;
DROP POLICY IF EXISTS public_all ON dre_caixa;
DROP POLICY IF EXISTS public_all ON dre_receita_competencia;
DROP POLICY IF EXISTS public_all ON dre_mapa;
CREATE POLICY public_all ON dre_contas_competencia  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY public_all ON dre_caixa               FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY public_all ON dre_receita_competencia FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY public_all ON dre_mapa                FOR ALL USING (true) WITH CHECK (true);

-- Conferência: 4 tabelas com RLS ligado
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('dre_contas_competencia', 'dre_caixa', 'dre_receita_competencia', 'dre_mapa');
