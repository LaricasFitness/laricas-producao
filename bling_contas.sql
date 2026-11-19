-- Financeiro › "Atualizar do Bling": detalhe das contas a pagar e a receber lidas pela API do Bling.
-- A lista do Bling não traz competência, categoria nem histórico; o detalhe de cada conta fica guardado
-- aqui para não ser buscado de novo a cada atualização (só quando o valor ou o vencimento mudam).
-- Só a função api/financeiro.mjs usa esta tabela (service_role): RLS ligado e SEM política, como
-- integracao_tokens — o navegador não lê nem grava. Pode rodar de novo sem problema.

CREATE TABLE IF NOT EXISTS bling_contas (
  id_bling      text PRIMARY KEY,              -- Id da conta no Bling
  tipo          text NOT NULL CHECK (tipo IN ('pagar', 'receber')),
  situacao      integer,                       -- 1 aberto, 2 pago, 3 parcial, 4 devolvido, 5 cancelado, 6 devolvido parcial, 7 confirmado
  vencimento    date,
  valor         numeric(14,2),
  competencia   date,
  categoria_id  bigint,                        -- categoria de receitas e despesas do Bling
  contato_id    bigint,
  contato_nome  text,
  contato_doc   text,                          -- CPF/CNPJ só com números
  historico     text,
  origem_id     text,                          -- pedido de venda / NF (contas a receber)
  detalhe_em    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bling_contas_tipo_comp_idx ON bling_contas (tipo, competencia);
CREATE INDEX IF NOT EXISTS bling_contas_contato_idx ON bling_contas (contato_id);

ALTER TABLE bling_contas ENABLE ROW LEVEL SECURITY;
