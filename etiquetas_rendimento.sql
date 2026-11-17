-- Etiquetas de validade: vínculo com o rendimento lançado na impressão.
-- Ao imprimir as etiquetas de uma produção, o nº de receitas e o peso total (opcionais) criam um
-- registro em preparacao_rendimento (o mesmo da tela Rendimentos); as etiquetas guardam qual foi.
-- etiquetas já tem RLS (etiquetas_validade.sql); aqui só entra a coluna.

alter table etiquetas
  add column if not exists rendimento_id uuid references preparacao_rendimento(id) on delete set null;

create index if not exists etiquetas_rendimento_idx on etiquetas (rendimento_id);

-- conferência
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'etiquetas' and column_name = 'rendimento_id';
