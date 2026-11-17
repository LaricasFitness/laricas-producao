-- Correção dos saldos de MP afetados pela NF 37767, contagens de Mel/Achocolatado
-- digitadas em kg, reabertura do CMV de outubro e desativação da Vitamina E.
--
-- O que aconteceu (logs do Supabase):
--   09/11 15:32 — a NF 37767 (foto) foi salva duas vezes ao mesmo tempo (clique duplo).
--                 Cada item foi gravado 2x em mp_compras, mas as duas gravações leram o
--                 mesmo saldo e uma apagou a outra: o saldo somou só UMA vez.
--   17/11 17:31–17:40 — as cópias foram excluídas em Estoque › Compras. A exclusão
--                 descontou a quantidade do saldo → o item ficou sem a compra.
--   Fermento: além disso, a compra foi corrigida de 3.600 g para 600 g (mais −3.000).
--
-- Conferido: saldo atual − (última contagem + compras − consumos) = exatamente −1 compra.
-- Rodar UMA vez só (soma ao saldo atual).

BEGIN;

-- JÁ APLICADO em 17/11/2026. Trava contra rodar de novo (somaria tudo outra vez).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM log_acoes WHERE usuario_nome = 'Sistema (correção)' AND acao = 'corrigir_saldo_mp') THEN
    RAISE EXCEPTION 'Esta correção já foi aplicada — não rode de novo.';
  END IF;
END $$;

CREATE TEMP TABLE corr(id uuid, delta numeric) ON COMMIT DROP;
INSERT INTO corr VALUES
  ('a47da9fc-15e8-4cab-a360-a1f551643351', 39150),  -- Mel (g)
  ('a55320b5-80fd-47a9-bd5b-bcd6107d0319',  3600),  -- Fermento (g)
  ('151b7a39-0dd7-4953-ad38-42d0f6e7d892',  1000),  -- Polvilho Doce (g)
  ('0bde8ef5-58f5-4e8b-987c-cd0b8d20980f',  1000),  -- Bicarbonato (g)
  ('dd74f042-8fb4-43fc-9906-54f8d18bcb99',   960),  -- Essência de Baunilha (ml)
  ('00d2946b-6e7e-4259-87de-0d34dd7ddc02',   500),  -- Coco flocos (g)
  ('c60882cb-d968-428b-a89f-2d41ebf3e991',   500),  -- Coco médio (g)
  ('b0b8759f-28f1-402f-8a50-89d710a61eaa',   400),  -- Amendoim torrado (g)
  ('c3f5b87e-f261-4e91-8712-ae2e8bf40816',   360),  -- Essência de Panetone (ml)
  ('ae1e7cd4-8451-46c9-bc67-99fe0ad9f14d',   300);  -- Cravo da índia (g)

INSERT INTO log_acoes (usuario_nome, acao, descricao, tabela, registro_id, dados_anteriores, dados_novos)
SELECT 'Sistema (correção)', 'corrigir_saldo_mp',
       'Saldo de "' || mp.nome || '" +' || c.delta || ' ' || mp.unidade ||
       ': NF 37767 salva 2x em 09/11 (saldo somou 1x) e a cópia excluída em 17/11 descontou de novo',
       'materias_primas', mp.id,
       jsonb_build_object('estoque_atual', mp.estoque_atual),
       jsonb_build_object('estoque_atual', mp.estoque_atual + c.delta)
  FROM corr c JOIN materias_primas mp ON mp.id = c.id;

UPDATE materias_primas mp
   SET estoque_atual = mp.estoque_atual + c.delta, atualizado_em = now()
  FROM corr c WHERE mp.id = c.id;

-- Contagens digitadas em kg em itens cadastrados em g (confirmado pelo usuário em 17/11):
--   Mel 30/10: 21 → 21.000 g · 05/11: 8 → 8.000 g e 8,7 → 8.700 g
--   Achocolatado 30/10: 0,63 → 630 g
-- O saldo atual parte da última contagem, então soma a diferença dela.
INSERT INTO log_acoes (usuario_nome, acao, descricao, tabela, registro_id, dados_anteriores, dados_novos)
SELECT 'Sistema (correção)', 'corrigir_contagem_mp',
       'Contagem de "' || mp.nome || '" em ' || to_char(c.data_conferencia, 'DD/MM') ||
       ' digitada em kg: ' || c.estoque_contado || ' → ' || c.estoque_contado * 1000 || ' g',
       'conferencia_mp', c.id,
       jsonb_build_object('estoque_contado', c.estoque_contado, 'estoque_sistema', c.estoque_sistema),
       jsonb_build_object('estoque_contado', c.estoque_contado * 1000,
         'estoque_sistema', CASE WHEN c.id = 'ed724eb5-f47f-401b-979a-6b12b20d1071' THEN c.estoque_sistema * 1000 ELSE c.estoque_sistema END)
  FROM conferencia_mp c JOIN materias_primas mp ON mp.id = c.materia_prima_id
 WHERE c.id IN ('5f9b40a5-f935-47d2-bf93-c2919f6ef035', '18f5b1f8-9a6e-4288-9c1c-a6285e8bd6f1',
                'ed724eb5-f47f-401b-979a-6b12b20d1071', '1155897f-5f5a-4218-94fa-bdafadf3d2e5');

UPDATE conferencia_mp SET estoque_contado = estoque_contado * 1000,
       observacao = observacao || ' [corrigido 17/11: contagem estava em kg]'
 WHERE id IN ('5f9b40a5-f935-47d2-bf93-c2919f6ef035', '18f5b1f8-9a6e-4288-9c1c-a6285e8bd6f1',
              'ed724eb5-f47f-401b-979a-6b12b20d1071', '1155897f-5f5a-4218-94fa-bdafadf3d2e5');
-- A recontagem de 05/11 19:14 tinha como "sistema" a contagem de 8 kg das 19:00
UPDATE conferencia_mp SET estoque_sistema = 8000 WHERE id = 'ed724eb5-f47f-401b-979a-6b12b20d1071';

INSERT INTO log_acoes (usuario_nome, acao, descricao, tabela, registro_id, dados_anteriores, dados_novos)
SELECT 'Sistema (correção)', 'corrigir_saldo_mp',
       'Saldo de "' || nome || '" +' || d || ' g: última contagem estava em kg',
       'materias_primas', id,
       jsonb_build_object('estoque_atual', estoque_atual), jsonb_build_object('estoque_atual', estoque_atual + d)
  FROM (SELECT mp.*, v.d FROM materias_primas mp
          JOIN (VALUES ('a47da9fc-15e8-4cab-a360-a1f551643351'::uuid, 8691.3),
                       ('edd24b3f-83d6-467f-aa55-a9c39a8bc8ba'::uuid, 629.37)) v(id, d) ON v.id = mp.id) x;
UPDATE materias_primas SET estoque_atual = estoque_atual + 8691.3, atualizado_em = now()
 WHERE id = 'a47da9fc-15e8-4cab-a360-a1f551643351';   -- Mel: 8,7 → 8.700
UPDATE materias_primas SET estoque_atual = estoque_atual + 629.37, atualizado_em = now()
 WHERE id = 'edd24b3f-83d6-467f-aa55-a9c39a8bc8ba';   -- Achocolatado: 0,63 → 630

-- Outubro fechou no CMV com o estoque final errado (Mel 21 g, Achocolatado 0,63 g).
-- Reabre outubro (mesmo efeito do botão Reabrir em Custos › CMV do Mês): o
-- primeiro acesso ao sistema fecha de novo, já com as contagens corrigidas.
INSERT INTO log_acoes (usuario_nome, acao, descricao, tabela)
VALUES ('Sistema (correção)', 'reabrir_cmv', 'CMV de 10/2026 reaberto: contagens de Mel e Achocolatado corrigidas (kg → g)', 'fechamento_cmv');
DELETE FROM fechamento_cmv WHERE mes >= '2026-10';

-- Vitamina E: fora de todas as fichas desde agosto. Desativa (mantém o histórico).
INSERT INTO log_acoes (usuario_nome, acao, descricao, tabela, registro_id, dados_anteriores, dados_novos)
VALUES ('Sistema (correção)', 'desativar_mp', 'Vitamina E desativada: não é mais usada',
        'materias_primas', 'c27a78fd-fec3-45c9-978f-0854da41b9c7', '{"ativo":true}', '{"ativo":false}');
UPDATE materias_primas SET ativo = false, atualizado_em = now()
 WHERE id = 'c27a78fd-fec3-45c9-978f-0854da41b9c7';

COMMIT;

-- Conferência: só devem sobrar negativos Cenoura, Ovo e Limão (consumo real > compras lançadas)
SELECT nome, unidade, round(estoque_atual, 1) AS saldo
  FROM materias_primas WHERE ativo AND estoque_atual < 0 ORDER BY estoque_atual;
