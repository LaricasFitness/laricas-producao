-- DRE por competência: Clube de Assinatura (jan–out/26) e Mercado Livre (out/26), pelos pedidos de venda do Bling
-- (lojas "Clube de Assinatura - Rits Pay" e "Loja Mercado Livre - 01"), pela data do pedido, sem os cancelados.
--   Clube:         receita = produtos + frete cobrado; descontos = desconto do pedido; recebido = total do pedido
--                  (taxa da Rits Pay não está no pedido do Bling)
--   Mercado Livre: receita = produtos; comissão e taxas = comissão do ML + frete pago ao ML;
--                  recebido = líquido do Mercado Pago (R$ 1.542,15 em out, confere com o relatório do MP)
-- Vão para as linhas novas da DRE "Clube de Assinatura" e "Mercado Livre". Pode rodar de novo: substitui o mês.

INSERT INTO dre_canal_competencia
  (mes, canal, unidade, vendas, promocoes, taxas, servicos, marketing, ajustes, total_faturamento, unidade_print, detalhes, origem)
VALUES
  ('2026-01', 'Clube', '', 2365.50, 511.77, 0, 0, 0, 0, 1853.73, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (11 pedidos)","valor":2365.50},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-511.77}]'::jsonb, 'planilha'),
  ('2026-02', 'Clube', '', 2650.60, 540.56, 0, 0, 0, 0, 2110.04, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (13 pedidos)","valor":2650.60},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-540.56}]'::jsonb, 'planilha'),
  ('2026-03', 'Clube', '', 4082.78, 852.25, 0, 0, 0, 0, 3230.53, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (19 pedidos)","valor":4082.78},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-852.25}]'::jsonb, 'planilha'),
  ('2026-04', 'Clube', '', 4651.72, 803.35, 0, 0, 0, 0, 3848.37, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (21 pedidos)","valor":4651.72},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-803.35}]'::jsonb, 'planilha'),
  ('2026-05', 'Clube', '', 6668.03, 1183.03, 0, 0, 0, 0, 5485.00, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (27 pedidos)","valor":6653.03},{"grupo":"vendas","descricao":"Frete cobrado","valor":15.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1183.03}]'::jsonb, 'planilha'),
  ('2026-06', 'Clube', '', 6950.71, 1128.26, 0, 0, 0, 0, 5822.45, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (28 pedidos)","valor":6905.71},{"grupo":"vendas","descricao":"Frete cobrado","valor":45.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1128.26}]'::jsonb, 'planilha'),
  ('2026-07', 'Clube', '', 7553.22, 1228.11, 0, 0, 0, 0, 6325.11, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (35 pedidos)","valor":7508.22},{"grupo":"vendas","descricao":"Frete cobrado","valor":45.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1228.11}]'::jsonb, 'planilha'),
  ('2026-08', 'Clube', '', 6660.28, 1104.48, 0, 0, 0, 0, 5555.80, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (29 pedidos)","valor":6615.28},{"grupo":"vendas","descricao":"Frete cobrado","valor":45.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1104.48}]'::jsonb, 'planilha'),
  ('2026-09', 'Clube', '', 7046.80, 1152.26, 0, 0, 0, 0, 5894.54, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (29 pedidos)","valor":7001.80},{"grupo":"vendas","descricao":"Frete cobrado","valor":45.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1152.26}]'::jsonb, 'planilha'),
  ('2026-10', 'Clube', '', 7031.76, 1156.81, 0, 0, 0, 0, 5874.95, 'Bling · Clube de Assinatura - Rits Pay', '[{"grupo":"vendas","descricao":"Produtos (30 pedidos)","valor":7001.76},{"grupo":"vendas","descricao":"Frete cobrado","valor":30.00},{"grupo":"promocoes","descricao":"Desconto do clube","valor":-1156.81}]'::jsonb, 'planilha'),
  ('2026-10', 'Mercado Livre', '', 2276.96, 0, 734.81, 0, 0, 0, 1542.15, 'Bling · Loja Mercado Livre - 01', '[{"grupo":"vendas","descricao":"Produtos (28 pedidos)","valor":2276.96},{"grupo":"taxas","descricao":"Comissão do Mercado Livre","valor":-432.60},{"grupo":"taxas","descricao":"Frete pago ao Mercado Livre","valor":-302.21}]'::jsonb, 'planilha')
ON CONFLICT (mes, canal, unidade) DO UPDATE SET
  vendas = EXCLUDED.vendas, promocoes = EXCLUDED.promocoes, taxas = EXCLUDED.taxas, servicos = EXCLUDED.servicos,
  marketing = EXCLUDED.marketing, ajustes = EXCLUDED.ajustes, total_faturamento = EXCLUDED.total_faturamento,
  unidade_print = EXCLUDED.unidade_print, detalhes = EXCLUDED.detalhes, origem = EXCLUDED.origem, atualizado_em = now();

-- Conferência: Clube 10 meses, Mercado Livre 1 mês; nao_fecha deve ser 0
SELECT canal, count(*) AS meses, sum(vendas) AS receita, sum(promocoes) AS descontos, sum(taxas) AS taxas, sum(total_faturamento) AS liquido,
  count(*) FILTER (WHERE abs(vendas - promocoes - taxas - total_faturamento) > 0.05) AS nao_fecha
FROM dre_canal_competencia WHERE canal IN ('Clube', 'Mercado Livre') GROUP BY canal;
