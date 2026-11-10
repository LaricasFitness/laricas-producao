-- DRE por caixa: "Transferências recebidas" do Bling deixam de ser transferência entre contas.
-- Aporte/empréstimo (pelo histórico) continua fora da DRE; multa de cancelamento, reembolso etc. vão para
-- Outras receitas. A regra fica no sistema; aqui só corrige o tipo dos lançamentos já importados.

UPDATE dre_caixa_lancamentos SET tipo = 'receita' WHERE categoria = 'Transferências recebidas' AND tipo = 'transferencia';

-- Conferência: 9 aportes (fev, R$ 78.500) e 3 outras receitas (jul e out, R$ 563,80)
SELECT CASE WHEN historico ~* 'aporte|empr[eé]stimo|capital|m[uú]tuo' THEN 'fora (aporte)' ELSE 'outras receitas' END AS destino,
  count(*), sum(valor)
FROM dre_caixa_lancamentos WHERE categoria = 'Transferências recebidas' GROUP BY 1;
