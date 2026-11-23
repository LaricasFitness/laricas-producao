-- Página Hoje: tarefas marcadas à mão como concluídas (as automáticas não precisam de registro).
-- ref identifica a ocorrência: a data (AAAA-MM-DD) nas diárias, a segunda-feira da semana nas semanais,
-- o mês (AAAA-MM) nas mensais. Desmarcar apaga a linha. Pode rodar de novo sem problema.

CREATE TABLE IF NOT EXISTS tarefas_marcadas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa      text NOT NULL,              -- id da tarefa em src/lib/tarefas.js
  ref         text NOT NULL,
  marcado_por text,
  marcado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tarefa, ref)
);

ALTER TABLE tarefas_marcadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_all ON tarefas_marcadas;
CREATE POLICY public_all ON tarefas_marcadas FOR ALL USING (true) WITH CHECK (true);
