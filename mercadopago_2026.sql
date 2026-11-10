-- Venda Ativação e Venda Balcão por competência (mês da compra), do relatório de Vendas do Mercado Pago,
-- jan a out/2026. Loja "Ativação" → Venda Ativação; loja "Loja" a partir de jul/26 → Venda Balcão
-- (antes já estava em Venda Direta pelo Bling). Pix do site e links de pagamento (B2B) ficam fora.
-- Receita = valor do produto; comissão e taxas = tarifa do Mercado Pago. Pode rodar de novo: substitui o mês.

INSERT INTO dre_canal_competencia
  (mes, canal, unidade, vendas, promocoes, taxas, servicos, marketing, ajustes, total_faturamento, unidade_print, detalhes, origem)
VALUES
  ('2026-01', 'Ativação', '', 1259.60, 0.00, 26.44, 0, 0, 0, 1233.16, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (26)","valor":1259.6},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-26.44}]'::jsonb, 'planilha'),
  ('2026-02', 'Ativação', '', 632.60, 0.00, 17.50, 0, 0, 0, 615.10, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (10)","valor":632.6},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-17.5}]'::jsonb, 'planilha'),
  ('2026-03', 'Ativação', '', 6245.30, 0.00, 150.34, 0, 0, 0, 6094.96, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (74)","valor":6245.3},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-145.66},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-4.68}]'::jsonb, 'planilha'),
  ('2026-04', 'Ativação', '', 737.40, 0.00, 17.34, 0, 0, 0, 720.06, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (18)","valor":737.4},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-17.34}]'::jsonb, 'planilha'),
  ('2026-05', 'Ativação', '', 4066.27, 0.00, 79.77, 0, 0, 0, 3986.50, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (83)","valor":4066.27},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-79.77}]'::jsonb, 'planilha'),
  ('2026-06', 'Ativação', '', 1066.90, 0.00, 25.78, 0, 0, 0, 1041.12, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (27)","valor":1066.9},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-18.27},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-7.51}]'::jsonb, 'planilha'),
  ('2026-07', 'Ativação', '', 1359.67, 0.00, 8.16, 0, 0, 0, 1351.51, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (21)","valor":1359.67},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-8.16}]'::jsonb, 'planilha'),
  ('2026-07', 'Balcão', '', 258.12, 0.00, 2.92, 0, 0, 0, 255.20, 'Mercado Pago · loja Loja', '[{"grupo":"vendas","descricao":"Vendas (10)","valor":258.12},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-2.26},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-0.66}]'::jsonb, 'planilha'),
  ('2026-08', 'Ativação', '', 6096.53, 0.00, 77.70, 0, 0, 0, 6018.83, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (140)","valor":6096.53},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-62.06},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-15.64}]'::jsonb, 'planilha'),
  ('2026-08', 'Balcão', '', 474.58, 0.00, 5.63, 0, 0, 0, 468.95, 'Mercado Pago · loja Loja', '[{"grupo":"vendas","descricao":"Vendas (11)","valor":474.58},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-4.51},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-1.12}]'::jsonb, 'planilha'),
  ('2026-09', 'Ativação', '', 1623.96, 0.00, 31.08, 0, 0, 0, 1592.88, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (43)","valor":1623.96},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-23.09},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-7.99}]'::jsonb, 'planilha'),
  ('2026-09', 'Balcão', '', 568.36, 0.00, 9.80, 0, 0, 0, 558.56, 'Mercado Pago · loja Loja', '[{"grupo":"vendas","descricao":"Vendas (6)","valor":568.36},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-7.84},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-1.96}]'::jsonb, 'planilha'),
  ('2026-10', 'Ativação', '', 6687.30, 0.00, 149.76, 0, 0, 0, 6537.54, 'Mercado Pago · loja Ativação', '[{"grupo":"vendas","descricao":"Vendas (133)","valor":6687.3},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-107.75},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-42.01}]'::jsonb, 'planilha'),
  ('2026-10', 'Balcão', '', 286.80, 0.00, 7.61, 0, 0, 0, 279.19, 'Mercado Pago · loja Loja', '[{"grupo":"vendas","descricao":"Vendas (6)","valor":286.8},{"grupo":"taxas","descricao":"Tarifa do Mercado Pago","valor":-5.37},{"grupo":"taxas","descricao":"Custo de parcelamento","valor":-2.24}]'::jsonb, 'planilha')
ON CONFLICT (mes, canal, unidade) DO UPDATE SET
  vendas = EXCLUDED.vendas, promocoes = EXCLUDED.promocoes, taxas = EXCLUDED.taxas, servicos = EXCLUDED.servicos,
  marketing = EXCLUDED.marketing, ajustes = EXCLUDED.ajustes, total_faturamento = EXCLUDED.total_faturamento,
  unidade_print = EXCLUDED.unidade_print, detalhes = EXCLUDED.detalhes, origem = EXCLUDED.origem, atualizado_em = now();

-- Conferência: Ativação 10 meses, Balcão 4 meses (jul–out); nao_fecha deve ser 0
SELECT canal, count(*) AS meses, sum(vendas) AS vendas, sum(taxas) AS taxas, sum(total_faturamento) AS recebido,
  count(*) FILTER (WHERE abs(vendas - promocoes - taxas - total_faturamento) > 0.05) AS nao_fecha
FROM dre_canal_competencia WHERE canal IN ('Ativação', 'Balcão') GROUP BY canal ORDER BY canal;
