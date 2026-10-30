-- RODAR ANTES DO PUSH.
-- Corrige o efeito da regra antiga "compra com data <= última contagem não soma ao
-- saldo": a data da NF não diz quando a mercadoria chegou.
--
-- 1) Coluna nova: entrou_no_saldo = false quando a compra NÃO somou ao estoque.
-- 2) Marca as 6 compras que não somaram (lançadas de 14/10 em diante).
--    O saldo atual NÃO muda: coberturas já foram acertadas pela conferência de 23/10
--    e o whey da NF 000409200 chegou antes da contagem de 23/10 (informado pelo Lucas).
-- 3) Conferências de 23/10 das coberturas: o "sistema" passa a incluir a compra de
--    16/10, para a diferença mostrar a divergência real.

BEGIN;

ALTER TABLE mp_compras ADD COLUMN IF NOT EXISTS entrou_no_saldo boolean NOT NULL DEFAULT true;

UPDATE mp_compras SET entrou_no_saldo = false
WHERE id IN (
  '6026300e-d5ed-4994-a454-4fbce2fa1c71',  -- Cobertura ao leite, 100 kg, NF 000.025.049
  'd76841c4-985f-49d4-b842-122e565f10a0',  -- Cobertura branca, 70 kg, NF 000.025.049
  'a986da5d-7b4f-451a-a9aa-30b6d1f9c1a1',  -- Biscoito Dark Vanilla, 4,2 kg, NF 000074478
  '87c62d90-fcc6-407d-be84-756e29e58dfb',  -- Whey chocolate, 4 kg, NF 000409200
  'd5721df7-ae32-4594-9329-742dc6988e31',  -- Whey baunilha, 4 kg, NF 000409200
  '538b816e-a384-42fa-b6c6-519a002f7374'   -- Whey doce de leite, 4 kg, NF 000409200
);

UPDATE conferencia_mp
SET estoque_sistema = estoque_sistema + 100000,
    observacao = COALESCE(observacao, '') || ' | Sistema corrigido: inclui compra de 100 kg (NF 000.025.049) que não havia somado ao saldo'
WHERE id = '7bcc02b9-33aa-4de0-84dc-af52d2f1dc9b' AND estoque_sistema = 18494.933;

UPDATE conferencia_mp
SET estoque_sistema = estoque_sistema + 70000,
    observacao = COALESCE(observacao, '') || ' | Sistema corrigido: inclui compra de 70 kg (NF 000.025.049) que não havia somado ao saldo'
WHERE id = '66ce19bb-fe24-485f-8360-efad299110f8' AND estoque_sistema = 35712.115;

-- Conferência: diferenças esperadas +7.505,067 g (ao leite) e −3.712,115 g (branca)
SELECT m.nome, c.estoque_sistema, c.estoque_contado, c.diferenca
FROM conferencia_mp c JOIN materias_primas m ON m.id = c.materia_prima_id
WHERE c.id IN ('7bcc02b9-33aa-4de0-84dc-af52d2f1dc9b', '66ce19bb-fe24-485f-8360-efad299110f8');

COMMIT;
