# Loopin.tv - Sistema de Digital Signage

## Visão Geral do Projeto

Loopin.tv é uma plataforma de digital signage que permite empresas gerenciarem e exibirem conteúdo em múltiplas telas (dispositivos Android TV). O sistema consiste em:

- **Admin Panel (Web)**: Painel web para administrador gerenciar telas, playlists e conteúdo
- **Android App**: Player que roda em boxes Android TV, fazendo download e exibindo conteúdo
- **Backend**: Supabase (PostgreSQL + Storage + Edge Functions)
- **Database**: Supabase (PostgreSQL)

## Stack Tecnológico

| Componente | Tecnologia |
|------------|------------|
| Frontend | JavaScript (vanilla), HTML, CSS |
| Backend | Supabase (PostgreSQL, Storage, Edge Functions) |
| Android | Kotlin, ExoPlayer, OkHttp, Glide |
| File Storage | Supabase Storage (bucket: medias) |
| Scheduling | cron-job.org para Edge Functions |

## Estrutura de Pastas

```
Loopin.tv-main/
├── frontend/                    # Painel admin web
│   └── src/
│       ├── screens/             # Gerenciamento de telas
│       ├── campaigns/            # Gerenciamento de campanhas
│       ├── playlists/           # Gerenciamento de playlists
│       ├── locations/           # Gerenciamento de locais
│       ├── advertisers/         # Gerenciamento de anunciantes
│       ├── dynamic-content/     # Widgets dinâmicos
│       ├── dashboard/            # Dashboard principal
│       ├── shared/              # Funções compartilhadas (api-helpers.js)
│       └── settings/            # Configurações do usuário
├── Android/                      # App Android TV
│   └── app/src/main/
│       ├── java/com/loopin/loopintv/
│       │   ├── MainActivity.kt       # Player principal
│       │   ├── SupabaseManager.kt    # Comunicação com banco
│       │   ├── SupabaseConfig.kt     # Configurações (URL, API key)
│       │   ├── WatchdogService.kt   # Serviço de background
│       │   └── BootReceiver.kt      # Receiver para boot
│       └── res/                 # Recursos (layouts, drawables)
├── supabase/                    # Edge Functions
│   └── functions/
│       └── mark-expired-campaigns/  # Marca campanhas expiradas
├── sql/                        # Scripts SQL para banco
│   ├── add_business_hours_locations.sql
│   ├── add_is_muted_screens.sql
│   ├── create_player_logs.sql
│   ├── create_screenshots_bucket.sql
│   └── auto_pause_expired_campaigns.sql
└── AGENTS.md                   # Instruções para agentes de IA
```

## Banco de Dados - Tabelas Principais

### screens
Armazena as TVs/dispositivos.
- `id` (UUID) - Identificador único da tela
- `device_id` (VARCHAR) - Código de pareamento (ex: TELA-ABC123)
- `user_id` (UUID) - Usuário dono da tela
- `name` (VARCHAR) - Nome amigável da tela
- `location_id` (UUID) - Local onde a tela está
- `active_playlist_id` (UUID) - Playlist ativa
- `orientation` (VARCHAR) - landscape/portrait
- `is_muted` (BOOLEAN) - Se a tela está mutada
- `status` (VARCHAR) - online/offline
- `last_ping` (TIMESTAMP) - Última comunicação

### playlists
Armazena as playlists.
- `id` (UUID)
- `user_id` (UUID)
- `name` (VARCHAR)
- `description` (TEXT)
- `loop_enabled` (BOOLEAN)
- `duration_total` (INTEGER) - Duração total em segundos

### playlist_items
Itens dentro das playlists (campanhas e widgets).
- `id` (UUID)
- `playlist_id` (UUID)
- `campaign_id` (UUID) - FK para campaigns (pode ser null)
- `widget_id` (UUID) - FK para dynamic_contents (pode ser null)
- `duration` (INTEGER) - Duração em segundos (sobrescreve o padrão)
- `display_order` (INTEGER)

### campaigns
Campanhas/mídias (imagens e vídeos).
- `id` (UUID)
- `user_id` (UUID)
- `advertiser_id` (UUID) - FK para advertisers
- `name` (VARCHAR) - Nome da campanha
- `media_url` (VARCHAR) - URL do arquivo no Supabase Storage
- `media_type` (VARCHAR) - image/video
- `duration_seconds` (INTEGER) - Duração padrão
- `start_date` (DATE) - Data de início
- `end_date` (DATE) - Data de fim
- `status` (VARCHAR) - active/paused/completed
- `priority` (VARCHAR) - bronze/silver/gold
- `file_path` (VARCHAR) - Path no storage

### locations
Locais onde as telas estão.
- `id` (UUID)
- `user_id` (UUID)
- `name` (VARCHAR)
- `address` (TEXT)
- `business_hours` (JSONB) - Horários de funcionamento
- `timezone` (VARCHAR) - Timezone (padrão: America/Sao_Paulo)

**Formato business_hours:**
```json
{
  "mon": {"open": "09:00", "close": "18:00", "turn2": {"open": "14:00", "close": "22:00"}},
  "tue": {"open": "09:00", "close": "18:00"},
  "wed": {"open": "09:00", "close": "18:00"},
  "thu": {"open": "09:00", "close": "18:00"},
  "fri": {"open": "09:00", "close": "18:00"},
  "sat": {"open": "10:00", "close": "14:00"},
  "sun": {}
}
```

### dynamic_contents
Widgets/conteúdo dinâmico.
- `id` (UUID)
- `user_id` (UUID)
- `name` (VARCHAR)
- `content_type` (VARCHAR) - ticker/text/weather/html/news
- `configuration` (JSONB) - Configuração específica do tipo
- `is_active` (BOOLEAN)

**Configurações por tipo:**
- ticker/text: `{"text": "...", "bg_color": "#000000", "text_color": "#ffffff", "speed": 50}`
- weather: `{"city": "São Paulo", "interval": 30}`
- news: `{"category": "Esportes", "interval": 60}`
- html: `{"html": "<div>...</div>"}`

### advertisers
Anunciantes/clientes.
- `id` (UUID)
- `user_id` (UUID)
- `name` (VARCHAR)
- `contact` (VARCHAR)
- `email` (VARCHAR)

### screen_commands
Comandos remotos para as telas.
- `id` (UUID)
- `screen_id` (UUID) - FK para screens
- `command` (VARCHAR) - refresh/restart/pause/resume/screenshot/update_orientation/maintenance_mode
- `payload` (TEXT) - Dados adicionais do comando
- `status` (VARCHAR) - pending/executed
- `created_at` (TIMESTAMP)
- `executed_at` (TIMESTAMP)

### player_logs
Logs de execução do player (para debug).
- `id` (UUID)
- `screen_id` (UUID)
- `event_type` (VARCHAR) - Tipo do evento
- `message` (TEXT) - Mensagem
- `metadata` (JSONB) - Dados adicionais
- `created_at` (TIMESTAMP)

### playback_logs
Logs de reprodução para relatórios.
- `id` (UUID)
- `screen_id` (UUID)
- `user_id` (UUID)
- `campaign_id` (UUID)
- `duration_seconds` (INTEGER)
- `created_at` (TIMESTAMP)

### settings
Configurações por usuário.
- `id` (UUID)
- `user_id` (UUID)
- `organization_name` (VARCHAR)
- `organization_logo_url` (VARCHAR)
- `api_weather_key` (VARCHAR) - Chave da API de clima (OpenWeatherMap)

## Buckets de Storage

### medias
Bucket para arquivos de campanhas.
- Arquivos: imagens e vídeos das campanhas
- Caminho: `{user_id}/{filename}`

### screenshots
Bucket para screenshots capturados remotamente.
- Arquivos: screenshots das telas
- Caminho: `{screen_uuid}_{timestamp}.png`

## Edge Functions

### mark-expired-campaigns
Marca automaticamente campanhas como "completed" quando a data de fim passa.
- Scheduling: via cron-job.org (recomendado: a cada hora)
- Endpoint: `https://[project].supabase.co/functions/v1/mark-expired-campaigns`

## Android App - Fluxo Principal

### MainActivity.kt - Ciclo de Sync
1. Verifica internet
2. Verifica se screen está registrada
3. Carrega settings (orientation, is_muted, business_hours)
4. Busca playlist
5. Verifica business hours (se fora do horário, mostra tela de "fora de horário")
6. Inicia reprodução

### renderMedia() - Lazy Loading
1. Verifica se arquivo existe em cache local
2. Se existe, usa do cache (funciona offline)
3. Se não existe e tem internet, baixa sob demanda
4. Se offline e sem cache, pula para o próximo item

### Comandos Remote Supportados
- `refresh` - Recarrega playlist
- `restart` - Reinicia o app
- `pause` - Pausa reprodução
- `resume` - Retoma reprodução
- `screenshot` - Captura tela e faz upload
- `update_orientation` - Altera orientação
- `maintenance_mode` - Entra em modo manutenção

## Comandos para Desenvolvimento

### Android
```bash
cd Android
./gradlew assembleDebug
```

### Deploy Edge Function
```bash
supabase functions deploy mark-expired-campaigns
```

### Database
```bash
# Resetar banco local
supabase db reset

# Ver migrations
supabase migration list
```

### Git
```bash
# Commits pequenos e frequentes
git add .
git commit -m "feat: descrição"
git push
```

## Regras de Negócio Importantes

1. **Device ID**: Telas são identificadas por `device_id` (formato: TELA-XXXXXX)
2. **Cache Offline**: Mídia baixada uma vez fica em cache local (500MB limite)
3. **Business Hours**: Quando fora do horário, mostra tela de "fora de horário"
4. **Prioridade**: Campanhas têm prioridade (bronze/silver/gold)
5. **Comandos Remote**: Polling a cada 10 segundos para novos comandos
6. **Ping**: Enviado a cada 30 segundos para manter status online
7. **Logs**: Todos os eventos importantes são enviados para player_logs

## Configurações do Android App

O app requer as seguintes permissões:
- INTERNET
- ACCESS_NETWORK_STATE
- RECEIVE_BOOT_COMPLETED
- WAKE_LOCK
- FOREGROUND_SERVICE

## Pontos de Debug/Logs

Os seguintes eventos são logados para debug no painel admin:
- `sync:start` - Início do ciclo
- `sync:no_internet` - Sem internet
- `sync:not_registered` - Screen não vinculada
- `sync:settings_loaded` - Configurações carregadas
- `sync:playlist_fetched:X` - Playlist obtida
- `sync:outside_hours` - Fora do horário
- `sync:business_hours_ok` - Dentro do horário
- `sync:playback_started` - Reprodução iniciada
- `media:cache_hit` - Usando cache offline
- `media:downloading` - Baixando mídia
- `media:download_failed` - Falha no download
- `media:offline_no_cache` - Offline e sem cache
- `media:playing` - Reproduzindo mídia
- `command_received` - Comando recebido
- `screenshot_taken` / `screenshot_failed` - Screenshots

## Integrações

### Weather API
- Open-Meteo (gratuito, padrão)
- OpenWeatherMap (opcional, precisa de API key nas settings do usuário)

### Cron
- cron-job.org para agendar Edge Functions

## Considerações de Performance

- **Lazy Loading**: Mídia é baixada sob demanda, não upfront (evita OOM em TV Boxes)
- **Cache Limit**: 500MB máximo para mídias cacheadas
- **Cleanup**: Arquivos antigos são removidos automaticamente
- **Polling Intervals**:
  - Playlist: 60 segundos
  - Comandos: 10 segundos
  - Ping: 30 segundos
  - Business hours check: 60 segundos