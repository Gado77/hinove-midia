-- Adiciona coluna is_muted na tabela screens
ALTER TABLE public.screens
ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.screens.is_muted IS 'Se true, a tela não emite som';
