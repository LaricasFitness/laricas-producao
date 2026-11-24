-- DRE Laricas, parte 4: multas de cancelamento do clube e reembolsos recebidos
-- Categoria "Reembolsos e Multas" do Bling → receita, linha própria (Multas e reembolsos recebidos).
-- Na competência, a aba Receitas preenche essa linha com o que entrou no mês (competência = caixa).
-- Exceção: devolução de uma compra (ex.: estorno de um pedido a fornecedor) não é receita. Classifique esse
-- lançamento à mão na conta da despesa; a entrada reduz a despesa no caixa e na competência.

INSERT INTO dre_plano (id, grupo, nome, ordem, so_caixa, cmo) VALUES
  ('rec.outras', 'rec', 'Multas e reembolsos recebidos', 90, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO dre_regras (categoria, fornecedor, conta, so_caixa) VALUES
  ('Reembolsos e Multas', NULL, 'rec.outras', false)
ON CONFLICT DO NOTHING;
