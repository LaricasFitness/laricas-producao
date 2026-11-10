-- Caixa do Bling, 2026-11-01 a 2026-11-10, todas as contas (Banco Inter - Brooklin, C6 BANK):
-- 85 lançamentos do extrato de Caixas e Bancos, um a um.
-- Mês em andamento: rodar de novo com um arquivo mais novo substitui o período, sem duplicar.




DELETE FROM dre_caixa_lancamentos WHERE data BETWEEN '2026-11-01' AND '2026-11-10';

INSERT INTO dre_caixa_lancamentos (id_bling, mes, data, tipo, categoria, nome, cnpj, historico, valor, banco) VALUES
  ('27353977251', '2026-11', '2026-11-01', 'despesa', 'Luz', 'ENEL', NULL, 'Conta de energia/luz', 2209.89, 'C6 BANK'),
  ('27353977349', '2026-11', '2026-11-01', 'despesa', 'Sistemas', 'SAIPOS', NULL, 'Sistema Delivery', 247.04, 'C6 BANK'),
  ('27353977424', '2026-11', '2026-11-01', 'despesa', 'Outros Digital', 'APPLE', NULL, 'Meta Verified', 120.90, 'C6 BANK'),
  ('27353977490', '2026-11', '2026-11-01', 'despesa', 'Equipamentos sem valor', 'Mercado Livre', NULL, 'Organizadores geladeira ifood', 35.83, 'C6 BANK'),
  ('27353977557', '2026-11', '2026-11-01', 'despesa', 'CMV - Matéria Prima', 'COMERCIAL LUZIA MEIRE DE GENEROS ALIMENTICIOS LTDA', '08991182000111', 'Pasta pistache', 71.41, 'C6 BANK'),
  ('27353977622', '2026-11', '2026-11-01', 'despesa', 'Equipamento', 'Mercado Livre', NULL, 'Datador M15', 92.57, 'C6 BANK'),
  ('27353977666', '2026-11', '2026-11-01', 'despesa', 'Sistema', 'Shopify', NULL, 'Sistema', 720.98, 'C6 BANK'),
  ('27353977718', '2026-11', '2026-11-01', 'despesa', 'Equipamento', 'Mercado Livre', NULL, 'Multiprocessador 5 Em 1 1000w Philco Turbo Com Espremedor', 99.77, 'C6 BANK'),
  ('27353977778', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Bobina Papel Filme Plástico Pvc 28cm X 800m - Miraway', 52.42, 'C6 BANK'),
  ('27353977825', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Etiqueta válidade', 43.54, 'C6 BANK'),
  ('27353977874', '2026-11', '2026-11-01', 'despesa', 'Outros OP', 'LAVANDERIA', NULL, 'Luvas e toalhas', 90.00, 'C6 BANK'),
  ('27353977932', '2026-11', '2026-11-01', 'despesa', 'CMV - Matéria Prima', 'TENDA ATACADO SA', '01157555005092', 'Ref. a NF nº 130458', 1216.70, 'C6 BANK'),
  ('27353978009', '2026-11', '2026-11-01', 'despesa', 'Tráfego Pago', 'GOOGLE', NULL, 'Ads', 1173.38, 'C6 BANK'),
  ('27353978064', '2026-11', '2026-11-01', 'despesa', 'CMV - Embalagens Envio', 'Mercado Livre', NULL, 'Bobina Térmica 80x40 Pdv Cupom Fiscal Senha Cx 20 Un Branco', 69.99, 'C6 BANK'),
  ('27353978119', '2026-11', '2026-11-01', 'despesa', 'CMV - Matéria Prima', 'Mercado Livre', NULL, 'Antimofo Para Alimentos (50g) - Mix', 65.94, 'C6 BANK'),
  ('27353978246', '2026-11', '2026-11-01', 'despesa', 'Ativação - Degustação', 'Mercado Livre', NULL, '400 Mini Copo Acrílico 25ml Brigadeiro Docinho Full Incolor', 78.85, 'C6 BANK'),
  ('27353978351', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Kit 10 Potes Marmita Fitness 300ml Bpa Free Microondas Transparente', 23.79, 'C6 BANK'),
  ('27353978426', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, '10 Touca De Redinha Capilar Luxo Cabelo Rede Preta Cozinha Cor Preto', 19.90, 'C6 BANK'),
  ('27353978525', '2026-11', '2026-11-01', 'despesa', 'Tráfego Pago', 'FACEBOOK', NULL, 'ads', 2923.01, 'C6 BANK'),
  ('27353978639', '2026-11', '2026-11-01', 'despesa', 'Equipamentos sem valor', 'Mercado Livre', NULL, 'Dispenser Epi Touca Descartável Acrílico Caixa Organizadora Dispenser Acrílic', 58.48, 'C6 BANK'),
  ('27353978743', '2026-11', '2026-11-01', 'despesa', 'CMV - Embalagens Envio', 'Mercado Livre', NULL, '1.000 Etiqueta Térmica Sem Rolo 10x15 /100x150 Formato Resma Cor Branc', 47.97, 'C6 BANK'),
  ('27353978848', '2026-11', '2026-11-01', 'despesa', 'Outros OP', 'Mercado Livre', NULL, 'Pilhas', 51.29, 'C6 BANK'),
  ('27353978959', '2026-11', '2026-11-01', 'despesa', 'CMV - Embalagens Envio', 'Mercado Livre', NULL, 'Fita Gomada Sem Reforço 70mm - 3 Unidades Marrom (kraft / Natural)', 61.90, 'C6 BANK'),
  ('27353979036', '2026-11', '2026-11-01', 'despesa', 'CMV - Embalagens Produto', 'Mercado Livre', NULL, '400 Lacre Termoencolhivel 63mm (9,5cm X 2,8cm)', 77.98, 'C6 BANK'),
  ('27353979101', '2026-11', '2026-11-01', 'despesa', 'Equipamentos sem valor', 'Mercado Livre', NULL, 'Assadeira Forma Estampada Alumínio Perfurada 35x35 Cm Forno Cinza', 136.14, 'C6 BANK'),
  ('27353979205', '2026-11', '2026-11-01', 'despesa', 'Equipamentos sem valor', 'Mercado Livre', NULL, 'Kit 4 Peneiras Aço Inox Profissional Cozinha Malha Fina Tamanhos Varia', 35.34, 'C6 BANK'),
  ('27353979284', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Kit 3 Papel Manteiga Antiaderente Rolo 10m X 30cm Forno', 81.68, 'C6 BANK'),
  ('27353979364', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Luva Viniflex Transparente Kit 1000un P M G Gg Sem Pó Vabene
10 Avental Descartável Tnt Anvisa Manga Longa Gramatura 20
Medix Touca Descartável Sanfonada Tnt Branco', 152.48, 'C6 BANK'),
  ('27353979442', '2026-11', '2026-11-01', 'despesa', 'Manutenção de Equipamento', 'Bennedita Pan', NULL, 'Manutenção motor', 98.35, 'C6 BANK'),
  ('27353979534', '2026-11', '2026-11-01', 'despesa', 'Equipamentos sem valor', 'Mercado Livre', NULL, 'Prato Para Microondas 30/31/36 Litros 31cm Todas As Marcas', 83.98, 'C6 BANK'),
  ('27353979608', '2026-11', '2026-11-01', 'despesa', 'CMV - Embalagens Envio', 'Mercado Livre', NULL, 'Etiqueta Lacre Segurança Delivery Alimentos Ifood 1000 Unidades Verm', 38.20, 'C6 BANK'),
  ('27353979703', '2026-11', '2026-11-01', 'despesa', 'CMV - Aux. Operação', 'Mercado Livre', NULL, 'Rolo Filme Pvc 45cm X 800m Alta Aderência Profissional', 92.89, 'C6 BANK'),
  ('27354002837', '2026-11', '2026-11-02', 'receita', 'Venda Site', 'MERCADO PAGO', NULL, 'Site', 761.30, 'C6 BANK'),
  ('27355045153', '2026-11', '2026-11-02', 'transferencia', 'Transferências de saída', '', NULL, 'Transferência Banco Inter - Brooklin -> C6 BANK', 1081.31, 'Banco Inter - Brooklin'),
  ('27355045163', '2026-11', '2026-11-02', 'transferencia', 'Transferências de entrada', '', NULL, 'Transferência Banco Inter - Brooklin -> C6 BANK', 1081.31, 'C6 BANK'),
  ('27354025374', '2026-11', '2026-11-03', 'despesa', 'CMV - Matéria Prima', 'LUCKAU INDUSTRIA E COMERCIO DE ALIMENTOS LTDA', '33188102000131', 'Ref. a NF nº 024669', 1903.50, 'C6 BANK'),
  ('27354025430', '2026-11', '2026-11-03', 'despesa', 'Transporte', 'Larissa Hellen Da Silva', NULL, 'VT (R$ 22,80 x n° dias)', 410.40, 'C6 BANK'),
  ('27354025506', '2026-11', '2026-11-03', 'despesa', 'Transporte', 'Teciane Aline Ferrara', NULL, 'VT (R$21,70 x dias)', 390.60, 'C6 BANK'),
  ('27354033624', '2026-11', '2026-11-03', 'receita', 'Venda Site', 'PAGAR.ME', NULL, 'Site', 4590.93, 'C6 BANK'),
  ('27354042025', '2026-11', '2026-11-03', 'despesa', 'Frete', 'MELHOR ENVIO', NULL, 'Frete', 300.00, 'C6 BANK'),
  ('27354049222', '2026-11', '2026-11-03', 'receita', 'Venda Site', 'MERCADO PAGO', NULL, 'Site', 482.44, 'C6 BANK'),
  ('27354091834', '2026-11', '2026-11-03', 'despesa', 'Prestador de Serviço', 'DUAS', NULL, 'Designer', 1442.67, 'C6 BANK'),
  ('27354106226', '2026-11', '2026-11-03', 'despesa', 'CMV - Matéria Prima', 'GROWTH SUPLEMENTOS', NULL, 'Whey', 1504.61, 'C6 BANK'),
  ('27354119094', '2026-11', '2026-11-03', 'despesa', 'Consultorias/Prestadores', 'CERELAB - LABORATORIOS QUIMICOS LTDA', NULL, 'Laudos microbiológicos', 631.51, 'C6 BANK'),
  ('27354517712', '2026-11', '2026-11-04', 'despesa', 'Salário', 'Larissa Hellen Da Silva', NULL, 'Salário', 900.00, 'C6 BANK'),
  ('27354517787', '2026-11', '2026-11-04', 'despesa', 'Salario Pessoal', 'Nathalia Correa Morgado (nd20260630134607)', '36191977840', 'Salário', 3250.00, 'C6 BANK'),
  ('27354517860', '2026-11', '2026-11-04', 'despesa', 'Salário', 'Marinice Alves Da Silva', NULL, 'Salário', 900.00, 'C6 BANK'),
  ('27354517919', '2026-11', '2026-11-04', 'despesa', 'Salário', 'FABIO GABRIEL', NULL, 'Salário', 2000.00, 'C6 BANK'),
  ('27354517955', '2026-11', '2026-11-04', 'despesa', 'Salário', 'Teciane Aline Ferrara', NULL, 'Salário', 1154.50, 'C6 BANK'),
  ('27354550369', '2026-11', '2026-11-04', 'despesa', 'CMV - Embalagens Produto', 'PRESSPLATE', NULL, '02 a 10/09', 1000.00, 'C6 BANK'),
  ('27354606608', '2026-11', '2026-11-04', 'despesa', 'Manutenção da Produção', 'BRUNO SIDNEY CARDOSO SILVA', NULL, 'Manutenção produção', 232.00, 'C6 BANK'),
  ('27354921514', '2026-11', '2026-11-04', 'receita', 'iFood', 'IFOOD BELA VISTA', NULL, 'BV', 4528.13, 'C6 BANK'),
  ('27354930546', '2026-11', '2026-11-04', 'receita', 'iFood', 'IFOOD BROOKLIN', NULL, 'BK', 2326.08, 'C6 BANK'),
  ('27354937502', '2026-11', '2026-11-04', 'receita', 'iFood', 'IFOOD MARINGÁ', NULL, 'PR', 1147.79, 'C6 BANK'),
  ('27354946742', '2026-11', '2026-11-04', 'receita', 'iFood', 'IFOOD DINOBERRY', NULL, 'ST', 724.98, 'C6 BANK'),
  ('27354955644', '2026-11', '2026-11-04', 'receita', 'Venda Site', 'PAGAR.ME', NULL, 'Vendas site', 3722.04, 'C6 BANK'),
  ('27354980022', '2026-11', '2026-11-04', 'receita', '99 Food', 'Nourishflow Brasil Ltda', NULL, '99 BV', 374.30, 'C6 BANK'),
  ('27354987376', '2026-11', '2026-11-04', 'receita', 'Anota.Ai', 'anota.ai', NULL, 'Anota.ai', 81.70, 'C6 BANK'),
  ('27354990334', '2026-11', '2026-11-04', 'receita', 'Keeta', 'Keeta', NULL, 'BV', 436.82, 'C6 BANK'),
  ('27354998843', '2026-11', '2026-11-04', 'receita', 'Venda Balcão', 'SARAH CANDIDA DOS ANJOS VIANA', NULL, 'Ref. ao pedido de venda nº 20728', 47.80, 'C6 BANK'),
  ('27355011758', '2026-11', '2026-11-04', 'receita', 'Revenda', 'DECASA MARKET LTDA', '63246477000171', 'Ref. ao pedido de venda nº 20536', 364.00, 'C6 BANK'),
  ('27355048375', '2026-11', '2026-11-04', 'receita', '99 Food', 'Nourishflow Brasil Ltda', NULL, 'BK', 171.19, 'Banco Inter - Brooklin'),
  ('27354389766', '2026-11', '2026-11-05', 'despesa', 'CMV - Matéria Prima', 'LUCKAU INDUSTRIA E COMERCIO DE ALIMENTOS LTDA', '33188102000131', 'Ref. a NF nº 024777', 2538.00, 'C6 BANK'),
  ('27354389809', '2026-11', '2026-11-05', 'despesa', 'Aluguel Produção', 'DECK 03', NULL, 'Liquidação de conta a pagar', 3700.00, 'C6 BANK'),
  ('27354389840', '2026-11', '2026-11-05', 'despesa', 'Frete', 'CORREIOS - SEDEX', '34028316003129', '16 a 15', 2993.72, 'C6 BANK'),
  ('27354389882', '2026-11', '2026-11-05', 'despesa', 'Sistemas', 'Controlid Ind Com De H E S T', NULL, 'Ponto eletronico', 60.00, 'C6 BANK'),
  ('27354405129', '2026-11', '2026-11-06', 'receita', 'Venda Site', 'PAGAR.ME', NULL, 'Site', 2166.98, 'C6 BANK'),
  ('27354414621', '2026-11', '2026-11-06', 'despesa', 'CMV - Matéria Prima', 'LUCKAU INDUSTRIA E COMERCIO DE ALIMENTOS LTDA', '33188102000131', 'Ref. a NF nº 025049', 2696.62, 'C6 BANK'),
  ('27354423019', '2026-11', '2026-11-06', 'despesa', 'CMV - Matéria Prima', 'AMERICAN PRODUCTS INC', NULL, 'WHEY', 1101.69, 'C6 BANK'),
  ('27354428362', '2026-11', '2026-11-06', 'despesa', 'CMV - Matéria Prima', 'GROWTH SUPLEMENTOS', NULL, 'Whey', 564.03, 'C6 BANK'),
  ('27354453987', '2026-11', '2026-11-06', 'receita', 'Venda Balcão', 'MICHELE SANTOS VIEIRA', NULL, 'Ref. ao pedido de venda nº 20723', 25.00, 'C6 BANK'),
  ('27354454019', '2026-11', '2026-11-06', 'receita', 'Venda Balcão', 'MARIA CELIA LARANJEIRA RIGONATTO BONIZIO', NULL, 'Ref. ao pedido de venda nº 20724', 49.50, 'C6 BANK'),
  ('27354469387', '2026-11', '2026-11-07', 'despesa', 'Limpeza e Higiêne', 'INEZ RODRIGUES DE OLIVEIRA', NULL, 'Faxina', 250.00, 'C6 BANK'),
  ('27354960870', '2026-11', '2026-11-07', 'receita', 'Venda Balcão', 'MATEUS CESPEDES SANTOS', NULL, 'Ref. ao pedido de venda nº 20725', 24.90, 'C6 BANK'),
  ('27354479132', '2026-11', '2026-11-08', 'receita', 'Venda Ativação', 'MERCADO PAGO', NULL, 'Ativações', 4392.11, 'C6 BANK'),
  ('27354481868', '2026-11', '2026-11-08', 'despesa', 'Aluguel Delivery', 'Oakberry', NULL, 'Aluguel iFood BV', 1500.00, 'C6 BANK'),
  ('27354487668', '2026-11', '2026-11-09', 'despesa', 'Salário', 'Virginia Barbara', NULL, 'Salário PJ', 4000.00, 'C6 BANK'),
  ('27354487720', '2026-11', '2026-11-09', 'despesa', 'CMV - Matéria Prima', 'Armazem Sao Vito Comercio De Produtos Alimenticios Ltda', '15083332000235', 'Ref. a NF nº 034380', 590.19, 'C6 BANK'),
  ('27354497459', '2026-11', '2026-11-09', 'despesa', 'Prestador de Serviço', 'ANA PAULA DOS SANTOS', NULL, 'VT FREELA', 21.40, 'C6 BANK'),
  ('27354502788', '2026-11', '2026-11-09', 'receita', 'Venda Site', 'PAGAR.ME', NULL, 'Vendas site', 2599.94, 'C6 BANK'),
  ('27355102033', '2026-11', '2026-11-09', 'receita', 'Revenda', 'Weisshaupt & Duarte Servicos Medicos LTDA', '59544920000113', 'Ref. ao pedido de venda nº 20376', 102.50, 'C6 BANK'),
  ('27355102058', '2026-11', '2026-11-09', 'receita', 'Revenda', 'Weisshaupt & Duarte Servicos Medicos LTDA', '59544920000113', 'Ref. ao pedido de venda nº 20377', 102.50, 'C6 BANK'),
  ('27355102089', '2026-11', '2026-11-09', 'receita', 'Revenda', 'Weisshaupt & Duarte Servicos Medicos LTDA', '59544920000113', 'Ref. ao pedido de venda nº 20394', 190.00, 'C6 BANK'),
  ('27355102124', '2026-11', '2026-11-09', 'receita', 'Revenda', 'BELA VISTA ESPORTES E EVENTOS LTDA', '56700799000183', 'Ref. ao pedido de venda nº 20417', 446.00, 'C6 BANK'),
  ('27355102150', '2026-11', '2026-11-09', 'receita', 'Revenda', 'BELA VISTA ESPORTES E EVENTOS LTDA', '56700799000183', 'Ref. ao pedido de venda nº 20418', 96.00, 'C6 BANK')
ON CONFLICT (id_bling) DO UPDATE SET mes = EXCLUDED.mes, data = EXCLUDED.data, tipo = EXCLUDED.tipo, categoria = EXCLUDED.categoria,
  nome = EXCLUDED.nome, cnpj = EXCLUDED.cnpj, historico = EXCLUDED.historico, valor = EXCLUDED.valor, banco = EXCLUDED.banco, importado_em = now();

-- Conferência: um mês por linha (entradas e saídas sem as transferências entre contas)
SELECT mes, count(*) AS lancamentos,
  sum(valor) FILTER (WHERE tipo = 'receita') AS entradas,
  sum(valor) FILTER (WHERE tipo = 'despesa') AS saidas,
  count(*) FILTER (WHERE tipo = 'transferencia') AS transferencias
FROM dre_caixa_lancamentos WHERE data BETWEEN '2026-11-01' AND '2026-11-10'
GROUP BY mes ORDER BY mes;

-- Classificação nova: VT de freelancer (Prestador de Serviço) junto com o vale-transporte
INSERT INTO dre_mapa (origem, categoria, nome, linha, atualizado_em)
VALUES ('competencia', 'Prestador de Serviço', 'ANA PAULA DOS SANTOS', 'df_operacional', now())
ON CONFLICT (origem, categoria, nome) DO UPDATE SET linha = EXCLUDED.linha, atualizado_em = now();
