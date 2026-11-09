-- Classificação inicial das categorias ambíguas do Bling na DRE (Financeiro › DRE).
-- Sugestão montada pelo fornecedor + observação de cada conta. Revise as marcadas
-- com "CONFERIR" antes de rodar — ou rode e ajuste depois na tela
-- (Financeiro › Importar e classificar › Ver e ajustar todas as categorias).
-- Só dados em tabela existente (dre_mapa) — RLS não muda. Pode rodar mais de uma vez.

INSERT INTO dre_mapa (origem, categoria, nome, linha) VALUES
-- Sem categoria no Bling ("-")
('competencia', '-', 'LUCKAU INDUSTRIA E COMERCIO DE ALIMENTOS LTDA',            'cmv'),            -- NFs de alimentos
('competencia', '-', 'ANDALUZ COMERCIO DE ALIMENTOS LTDA',                       'cmv'),
('competencia', '-', 'Armazem Sao Vito Comercio De Produtos Alimenticios Ltda',  'cmv'),
('competencia', '-', 'SALUTE INDUSTRIA DE PAPELAO ONDULADO LTDA',                'dv_comercial'),   -- caixas de envio
('competencia', '-', 'STATUS PRO HIGIENE E LIMPEZA LTDA',                        'dv_operacional'),
('competencia', '-', 'C6',                                                       'ignorar'),        -- CONFERIR: "Fatura cartão" — as compras do cartão já estão lançadas uma a uma; contar a fatura duplicaria
-- Delivery (existe em DV Comercial e DV Marketing)
('competencia', 'Delivery', 'IFOOD MARINGÁ',                                     'dv_comercial'),   -- CONFERIR: "Mobilets"
('competencia', 'Delivery', 'IFOOD DINOBERRY',                                   'dv_comercial'),   -- CONFERIR: "Prestação iFood ZN"
-- Outros
('competencia', 'Outros', 'FABIO GABRIEL',                                       'df_operacional'), -- rescisão / multa FGTS
('competencia', 'Outros', 'SONIA DOS SANTOS MARTINS',                            'df_operacional'), -- rescisão
('competencia', 'Outros', 'Guilherme Weisshaupt',                                'df_operacional'), -- acerto Sonia
('competencia', 'Outros', 'PGR',                                                 'df_operacional'), -- segurança do trabalho
('competencia', 'Outros', 'MALU',                                                'df_operacional'), -- salário
('competencia', 'Outros', 'PASI SERVIÇOS E BENEFÍCIOS',                          'df_operacional'), -- seguro estágio
('competencia', 'Outros', 'RESTOCLEAN DO BRASIL COM IMP EXP LTDA',               'dv_operacional'), -- locação tanque de limpeza
('competencia', 'Outros', 'Scatt Bike',                                          'dv_operacional'),
('competencia', 'Outros', 'Oakberry',                                            'dv_operacional'), -- CONFERIR: "Diária Extra"
('competencia', 'Outros', 'Multitintas',                                         'dv_operacional'),
('competencia', 'Outros', 'Mercado Livre',                                       'dv_operacional'),
('competencia', 'Outros', 'UNIAO TRANSPORTES',                                   'dv_comercial'),   -- frete latas
('competencia', 'Outros', 'Navarro Film',                                        'dv_marketing'),
('competencia', 'Outros', 'Victor Mello',                                        'dv_marketing'),
('competencia', 'Outros', 'Agnes Tremesquim',                                    'dv_marketing'),
('competencia', 'Outros', 'APPLE',                                               'dv_marketing'),   -- Meta Verified
('competencia', 'Outros', 'Maria Cecilia',                                       'dv_marketing'),   -- reembolso Uber mkt
('competencia', 'Outros', 'Envelopamento',                                       'dv_marketing'),   -- CONFERIR: envelopamento de frigobar (pode ser investimento)
('competencia', 'Outros', 'INPI',                                                'df_administrativo'),
('competencia', 'Outros', 'Bruno Arminio',                                       'df_administrativo'), -- INPI
('competencia', 'Outros', 'WIX',                                                 'df_administrativo'), -- e-mail
('competencia', 'Outros', 'Leo Vini',                                            'df_administrativo'), -- abertura filial
('competencia', 'Outros', 'Rappi',                                               'df_administrativo'),
-- Prestador de Serviço
('competencia', 'Prestador de Serviço', 'Maria Cecilia',                         'df_marketing'),   -- PJ social media
('competencia', 'Prestador de Serviço', 'BMT LUZ INTELIGENCIA DE MARKETING',     'df_marketing'),
('competencia', 'Prestador de Serviço', 'CAPSULA AGENCIA E PRODUTORA DIGITAL',   'df_marketing'),
('competencia', 'Prestador de Serviço', 'DUAS',                                  'df_marketing'),   -- designer
('competencia', 'Prestador de Serviço', 'INCREASE TECNOLOGIA E MARKETING',       'df_marketing'),   -- agência de tráfego
('competencia', 'Prestador de Serviço', 'HELENA SIMÕES',                         'df_marketing'),
('competencia', 'Prestador de Serviço', 'Rogerio Souza Barbosa',                 'df_marketing'),   -- CONFERIR: estacionamento Ceci
('competencia', 'Prestador de Serviço', 'Vivi Pavanelli',                        'dv_marketing'),   -- rebranding (projeto)
('competencia', 'Prestador de Serviço', 'Diego Horacio Sanchez',                 'dv_marketing'),   -- fotógrafo
('competencia', 'Prestador de Serviço', 'LEOVINI CONTABILIDADE',                 'df_administrativo'),
('competencia', 'Prestador de Serviço', 'LUAHNA CONSULTORIA',                    'df_administrativo'),
('competencia', 'Prestador de Serviço', 'DECK 03',                               'df_operacional'), -- dedetização / estacionamento
-- Salario Pessoal (existe em DF Administrativo, Comercial e Marketing)
('competencia', 'Salario Pessoal', 'Lucas Soares Pedroza Di Pompo',              'df_administrativo'), -- pró-labore
('competencia', 'Salario Pessoal', 'Nathalia Correa Morgado (nd20260630134607)', 'df_marketing'),
('competencia', 'Salario Pessoal', 'Giselle Santos',                             'df_marketing'),
('competencia', 'Salario Pessoal', 'Guilherme Weisshaupt',                       'df_marketing'),
-- Sistema (existe em DF Administrativo, DF Comercial, DV Comercial e DV Marketing)
('competencia', 'Sistema', 'Shopify',                                            'df_comercial'),
('competencia', 'Sistema', 'anota.ai',                                           'df_comercial'),
('competencia', 'Sistema', 'Claude.ai',                                          'df_administrativo'),
('competencia', 'Sistema', 'ANTHROPIC* CLAUDE SUB SA',                           'df_administrativo'),
('competencia', 'Sistema', 'GS1',                                                'df_administrativo')
ON CONFLICT (origem, categoria, nome) DO UPDATE SET linha = EXCLUDED.linha, atualizado_em = now();

-- Conferência: deve voltar 52
SELECT count(*) FROM dre_mapa WHERE origem = 'competencia';
