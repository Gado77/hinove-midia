// ==================== CONFIG.JS ====================
// Arquivo ÚNICO de configuração do Supabase
// Todos os demais arquivos dependem disso

const SUPABASE_URL = 'https://sxsmirhqbslmvyesikgg.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c21pcmhxYnNsbXZ5ZXNpa2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4NjMwOTYsImV4cCI6MjA3OTQzOTA5Nn0.ZLk6DAEfAZ2D451pGw1DO1h4oDIaZZgrgLOV6QUArB8'

// === AQUI FICARÁ SEU ENDPOINT DE CLOUDFLARE APÓS O DEPLOY ==== //
const CLOUDFLARE_WORKER_URL = 'https://loopin-media-worker.loopintv.workers.dev'

// Inicializa Supabase globalmente
const { createClient } = supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY)

console.log('✅ Supabase e Configs Iniciais carregadas.')