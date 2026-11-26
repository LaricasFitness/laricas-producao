-- DRE Laricas, parte 6: regras para as categorias do plano antigo do Bling (jan a jul/26), que ficavam sem
-- classificação na DRE de caixa do ano. Pode rodar mais de uma vez.
INSERT INTO dre_regras (categoria, fornecedor, conta, so_caixa) VALUES
  ('Aluguel', NULL, 'fo.aluguel', false),
  ('Salários', NULL, 'fo.equipe', false),
  ('Bonificação Operacional', NULL, 'fo.equipe', false),
  ('Diária', NULL, 'fo.equipe', false),
  ('Vale alimentação', NULL, 'fo.equipe', false),
  ('Vale transporte', NULL, 'fo.equipe', false),
  ('Pró-labore', NULL, 'fa.prolabore', false),
  ('Serviços contábeis', NULL, 'fa.contab', false),
  ('Energia elétrica', NULL, 'fo.energia', false),
  ('Manutenção/Compra Equipamento', NULL, 'vo.equip', false),
  ('Estrutural', NULL, 'vo.manut', false),
  ('Diária Evento', NULL, 'vm.ativ', false)
ON CONFLICT DO NOTHING;
-- Fica de fora: recebimentos SEM categoria no Bling (144 lançamentos, R$ 45.936, jan a abr). Não dá para saber o
-- canal pela regra: classifique na aba Lançamentos (ou ponha a categoria no Bling e atualize).
