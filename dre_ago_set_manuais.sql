-- Lançamentos manuais de agosto e setembro/26, tirados da planilha da DRE (LaricasV2, colunas de ago e set).
-- Só o que não vem do Bling nem dos relatórios: mídia pela planilha da agência, taxas descontadas na venda e a
-- anuidade do Fidelimax. Taxas do Mercado Pago, comissões das plataformas, produtos de influenciadores e
-- fretes NÃO entram aqui: vêm das importações (relatório/API do Mercado Pago, aba Receitas, produtos sem venda, fretes).
-- Pode rodar mais de uma vez: não duplica.

INSERT INTO dre_manuais (mes, descricao, conta, valor, por)
SELECT v.mes, v.descricao, v.conta, v.valor, 'planilha da DRE'
FROM (VALUES
  ('2026-08', 'Meta Ads (planilha da agência)',            'vm.midia', 1657.07::numeric),
  ('2026-08', 'Google Ads (planilha da agência)',          'vm.midia', 1132.95),
  ('2026-08', 'Pagar.me: taxas descontadas na venda',      'vc.cartao', 757.56),
  ('2026-08', 'Shopify Payments: taxas',                   'vc.cartao', 100.44),
  ('2026-08', 'Shopify: checkout abandonado',              'vc.cartao', 118.66),
  ('2026-08', 'Fidelimax: anuidade ÷ 12',                  'fo.sist',   349.17),
  ('2026-09', 'Meta Ads (planilha da agência)',            'vm.midia', 2460.14),
  ('2026-09', 'Google Ads (planilha da agência)',          'vm.midia', 1173.89),
  ('2026-09', 'Pagar.me: taxas descontadas na venda',      'vc.cartao', 769.29),
  ('2026-09', 'Shopify Payments: taxas',                   'vc.cartao', 145.84),
  ('2026-09', 'Shopify: checkout abandonado',              'vc.cartao', 330.46),
  ('2026-09', 'Fidelimax: anuidade ÷ 12',                  'fo.sist',   349.17)
) AS v(mes, descricao, conta, valor)
WHERE NOT EXISTS (SELECT 1 FROM dre_manuais m WHERE m.mes = v.mes AND m.descricao = v.descricao);
