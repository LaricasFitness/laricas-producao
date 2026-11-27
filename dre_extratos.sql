-- DRE Laricas: extratos dos bancos (conta corrente e investimentos) importados na Auditoria.
-- Cada linha do extrato do banco fica guardada para conferir com o caixa do Bling, lançamento por lançamento.
-- O saldo de cada fim de mês vai para dre_saldos (a tabela de saldos que já existe).
-- Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS dre_extrato_banco (
  conta     text NOT NULL,                 -- conta no Bling (ex.: 'C6 BANK'), a mesma de dre_saldos
  chave     text NOT NULL,                 -- FITID do OFX, ou data|valor|descrição|ocorrência (reimportar não duplica)
  mes       text NOT NULL,                 -- AAAA-MM da data
  data      date NOT NULL,                 -- data do lançamento no banco
  valor     numeric(14,2) NOT NULL,        -- entrada positiva, saída negativa
  descricao text,
  arquivo   text,
  por       text,
  em        timestamptz DEFAULT now(),
  PRIMARY KEY (conta, chave)
);
CREATE INDEX IF NOT EXISTS dre_extrato_banco_mes ON dre_extrato_banco (mes, conta);
ALTER TABLE dre_extrato_banco ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON dre_extrato_banco;
CREATE POLICY public_all ON dre_extrato_banco FOR ALL USING (true) WITH CHECK (true);
