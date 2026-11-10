-- DRE por caixa: classificação dos fornecedores/clientes que o extrato do Bling trouxe sem linha.
-- Despesas: categoria genérica do Bling ("Prestador de Serviço", "Sistema", "Outros", "Delivery") → por fornecedor;
-- vale também para a competência (mesma categoria + fornecedor).
-- Receitas: recebimento sem categoria (pedido de venda/NF) → por cliente.
-- Pode rodar mais de uma vez. Para mudar depois: Importar e classificar › Classificar categorias.

INSERT INTO dre_mapa (origem, categoria, nome, linha, atualizado_em) VALUES
  -- Despesas
  ('competencia', 'Prestador de Serviço', 'RESTOCLEAN DO BRASIL COM IMP EXP LTDA', 'dv_operacional', now()),   -- locação tanque limpeza
  ('competencia', 'Prestador de Serviço', 'NutriCare Assessoria e Consultoria em Nutrição Ltda.', 'dv_operacional', now()), -- consultoria
  ('competencia', 'Prestador de Serviço', 'Oakberry', 'df_operacional', now()),                          -- aluguel iFood BV
  ('competencia', 'Delivery', 'Jose Robens Da Silva', 'investimento', now()),                             -- obra Oak
  ('competencia', 'Prestador de Serviço', 'IFOOD DINOBERRY', 'df_operacional', now()),                   -- aluguel Delivery Santana
  ('competencia', 'Prestador de Serviço', 'KELLY CRISTINA DE OLIVEIRA', 'dv_operacional', now()),        -- faxina
  ('competencia', 'Prestador de Serviço', 'DARKSTORE BK', 'df_operacional', now()),                      -- aluguel BK
  ('competencia', 'Delivery', 'DARKSTORE BK', 'dv_comercial', now()),                                     -- 6% de comissão
  ('competencia', 'Sistema', 'RITS SOLUCOES EM TECNOLOGIA LTDA', 'df_administrativo', now()),           -- plataforma assinatura
  ('competencia', 'Prestador de Serviço', 'Victor Mello', 'dv_marketing', now()),                        -- videomaker
  ('competencia', 'Sistema', 'SAIPOS', 'df_comercial', now()),                                           -- sistema delivery (como Anota.AI)
  ('competencia', 'Outros', 'LINKEDIN', 'df_administrativo', now()),                                     -- anúncio de vaga
  ('competencia', 'Outros', 'BAR DO ZEBRA', 'df_operacional', now()),                                    -- almoço do time
  ('competencia', 'Sistema', 'TICKTICK', 'df_administrativo', now()),                                    -- organização
  ('competencia', 'Sistema', 'HOSTINGER', 'df_administrativo', now()),                                   -- servidor IA
  ('competencia', 'Sistema', 'CONTROL ID', 'df_operacional', now()),                                     -- controle de ponto
  ('competencia', 'Sistema', 'Controlid Ind Com De H E S T', 'df_operacional', now()),                   -- controle de ponto
  ('competencia', 'Sistema', 'OUTROS', 'df_comercial', now()),                                           -- frete na página do produto (app)
  ('competencia', 'Outros', 'Lucas Soares Pedroza Di Pompo', 'dv_marketing', now()),                     -- estacionamento FISPAL (feira)
  ('competencia', 'Outros', 'RCALIMENTOS', 'df_operacional', now()),                                     -- bolo para o time
  -- Receitas sem categoria: empresas → Revenda (B2B); pessoas → Venda Direta; reembolsos → Outras receitas
  ('caixa_receita', '', 'CROSSFIT MAIRIPORA ATIVIDADES ESPORTIVAS LTDA', 'rec_revenda', now()),
  ('caixa_receita', '', 'Fagundes Empório Natural', 'rec_revenda', now()),
  ('caixa_receita', '', 'Rosemary - Evollution', 'rec_revenda', now()),
  ('caixa_receita', '', 'Cléo Augusto - G4', 'rec_direta', now()),
  ('caixa_receita', '', 'Guilherme Weisshaupt', 'rec_direta', now()),
  ('caixa_receita', '', 'ANDALUZ COMERCIO DE ALIMENTOS LTDA', 'rec_outras', now()),                     -- reembolso de farinha
  ('caixa_receita', '', 'Elvira Monteiro', 'rec_direta', now()),
  ('caixa_receita', '', 'Manuela Marujo', 'rec_direta', now()),
  ('caixa_receita', '', 'Odair Arlindo Braga', 'rec_direta', now()),
  ('caixa_receita', '', 'Fabio Gumercindo Furtado (fabiogumercindofurtado)', 'rec_direta', now()),
  ('caixa_receita', '', 'Issbela Menezes', 'rec_direta', now()),
  ('caixa_receita', '', 'Guilherme Couto', 'rec_direta', now()),
  ('caixa_receita', '', 'Graziele Goulart', 'rec_direta', now()),
  ('caixa_receita', '', 'Manuela Jordão Parente', 'rec_direta', now()),
  ('caixa_receita', '', 'Eleonora De Campos Perez (peel7324615)', 'rec_direta', now()),
  ('caixa_receita', '', 'Catharine Carracossa Fernandes', 'rec_direta', now()),
  ('caixa_receita', '', 'Gabriela Andrade Mantovani', 'rec_direta', now()),
  ('caixa_receita', '', 'Beatriz Couto de Carvalho', 'rec_direta', now()),
  ('caixa_receita', '', 'Luciana Rocha', 'rec_direta', now()),
  ('caixa_receita', '', 'João Paulo de Campos Silva', 'rec_direta', now()),
  ('caixa_receita', '', 'Daniel Pereira Soares Costa', 'rec_direta', now()),
  ('caixa_receita', '', 'Eliana Venancio', 'rec_direta', now()),
  ('caixa_receita', '', 'Maria Sueli Andrade', 'rec_direta', now()),
  ('caixa_receita', '', 'Carlos Milito', 'rec_direta', now()),
  ('caixa_receita', '', 'Daniel Ventura', 'rec_direta', now()),
  ('caixa_receita', '', 'Anderson Vieira', 'rec_direta', now()),
  ('caixa_receita', '', 'Beatriz Machado da silva', 'rec_direta', now()),
  ('caixa_receita', '', 'Diego de Almeida', 'rec_direta', now()),
  ('caixa_receita', '', 'Alberto Adolphi', 'rec_direta', now()),
  ('caixa_receita', '', 'Matheus Alexandre', 'rec_direta', now())
ON CONFLICT (origem, categoria, nome) DO UPDATE SET linha = EXCLUDED.linha, atualizado_em = now();

-- Conferência: 50 classificações novas
SELECT origem, linha, count(*) FROM dre_mapa WHERE atualizado_em > now() - interval '5 minutes' GROUP BY 1, 2 ORDER BY 1, 2;
