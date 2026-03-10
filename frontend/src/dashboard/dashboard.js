/* ==================== DASHBOARD.JS ====================
   Lógica principal do Dashboard
   Dependências: config.js, utils.js, api-helpers.js
*/

let currentUser = null

// Quanto tempo sem ping considera offline (2 minutos)
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    currentUser = await checkAuth()
    if (!currentUser) return

    await loadSidebar('dashboard')

    Promise.all([
      loadKPIs(),
      loadRecentScreens(),
      loadUpcomingCampaigns(),
      loadRealtimeStatus()
    ])

    setupEventListeners()

    // Auto-atualiza o status a cada 30s (mesma frequência do ping da TV)
    setInterval(loadRealtimeStatus, 30000)

  } catch (error) {
    console.error('❌ Erro na inicialização:', error)
    showNotification('Erro ao carregar dashboard', 'error')
  }
})

// ==================== HELPER: STATUS REAL ====================

/**
 * Calcula se a tela está online de verdade baseado no last_ping.
 * Se o último ping foi há menos de 2 minutos → online.
 * Se não tem last_ping ou passou mais de 2 min → offline.
 */
function isScreenOnline(screen) {
  if (!screen.last_ping) return false
  const lastPing = new Date(screen.last_ping).getTime()
  const now = Date.now()
  return (now - lastPing) < OFFLINE_THRESHOLD_MS
}

/**
 * Formata o "último visto" com data + hora.
 * Ex: "Hoje, 14:32" / "Ontem, 09:15" / "05/03, 11:20"
 */
function formatLastSeen(lastPing) {
  if (!lastPing) return 'Nunca conectada'

  const date = new Date(lastPing)
  const now = new Date()

  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // Menos de 1 minuto
  if (diffMin < 1) return 'Agora mesmo'

  // Menos de 60 minutos
  if (diffMin < 60) return `Há ${diffMin} min`

  // Mesmo dia
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return `Hoje às ${timeStr}`

  // Ontem
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()
  if (isYesterday) return `Ontem às ${timeStr}`

  // Mais antigo: mostra data + hora
  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${dateStr} às ${timeStr}`
}

// ==================== KPIs ====================

async function loadKPIs() {
  try {
    const { data: screensAll } = await apiSelect('screens', {
      userId: currentUser.id,
      select: 'id, last_ping, status'
    })

    // Conta online pelo last_ping real (não pelo campo status do banco)
    const totalScreens = screensAll?.length || 0
    const onlineNow = screensAll?.filter(s => isScreenOnline(s)).length || 0

    updateKPI('totalScreens', totalScreens)
    updateElement('screensStatus', `${onlineNow} online agora`)

    const { data: playlists } = await apiSelect('playlists', {
      userId: currentUser.id, select: 'id'
    })
    updateKPI('totalPlaylists', playlists?.length || 0)
    updateElement('playlistsStatus', 'Ativas')

    const { data: campaigns } = await apiSelect('campaigns', {
      userId: currentUser.id, select: 'id', eq: { status: 'active' }
    })
    updateKPI('totalCampaigns', campaigns?.length || 0)
    updateElement('campaignsStatus', 'Em exibição')

    const { data: locations } = await apiSelect('locations', {
      userId: currentUser.id, select: 'id'
    })
    updateKPI('totalLocations', locations?.length || 0)
    updateElement('locationsStatus', 'Cadastrados')

  } catch (error) {
    console.error('❌ Erro ao carregar KPIs:', error)
  }
}

// ==================== TELAS RECENTES ====================

async function loadRecentScreens() {
  const tbody = document.getElementById('screensTable')

  try {
    const { data: screens, error } = await apiSelect('screens', {
      userId: currentUser.id,
      select: 'id, name, status, last_ping, locations (name), playlists (name)',
      order: { field: 'created_at', ascending: false },
      limit: 5
    })

    if (error) throw error

    if (!screens || screens.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: #718096;">Nenhuma tela encontrada</td></tr>'
      return
    }

    tbody.innerHTML = screens.map(screen => {
      const online = isScreenOnline(screen)
      const statusClass = online ? 'online' : 'offline'
      const statusText = online ? 'Online' : 'Offline'

      return `
        <tr>
          <td><strong>${escapeHtml(screen.name)}</strong></td>
          <td>${screen.locations?.name ? escapeHtml(screen.locations.name) : '<span style="color: #CBD5E0;">-</span>'}</td>
          <td>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </td>
          <td>${screen.playlists?.name ? escapeHtml(screen.playlists.name) : '<span style="color: #CBD5E0;">-</span>'}</td>
        </tr>
      `
    }).join('')

  } catch (error) {
    console.error('❌ Erro em Telas Recentes:', error)
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #E53E3E;">Erro ao carregar dados</td></tr>'
  }
}

// ==================== CAMPANHAS PRÓXIMAS ====================

async function loadUpcomingCampaigns() {
  const tbody = document.getElementById('campaignsTable')

  try {
    const today = new Date().toISOString().split('T')[0]

    const { data: campaigns, error } = await apiSelect('campaigns', {
      userId: currentUser.id,
      select: 'id, priority, start_date, end_date, name, advertisers (name)',
      order: { field: 'start_date', ascending: true },
      limit: 5
    })

    if (error) throw error

    const filtered = campaigns?.filter(c => c.end_date >= today) || []

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 40px; color: #718096;">Nenhuma campanha programada</td></tr>'
      return
    }

    tbody.innerHTML = filtered.map(camp => `
      <tr>
        <td><strong>${escapeHtml(camp.name || 'Sem nome')}</strong></td>
        <td>${camp.advertisers?.name || '-'}</td>
        <td>${formatDate(camp.start_date)}</td>
        <td>
          <span class="priority-badge ${camp.priority}">
            ${translatePriority(camp.priority)}
          </span>
        </td>
      </tr>
    `).join('')

  } catch (error) {
    console.error('❌ Erro em Campanhas:', error)
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #E53E3E;">Erro ao carregar dados</td></tr>'
  }
}

// ==================== STATUS REALTIME ====================

async function loadRealtimeStatus() {
  const container = document.getElementById('statusContainer')

  try {
    const { data: screens, error } = await apiSelect('screens', {
      userId: currentUser.id,
      select: 'id, name, status, last_ping',
      order: { field: 'name', ascending: true }
    })

    if (error) throw error

    if (!screens || screens.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: #718096; padding: 24px;">Nenhuma tela monitorada</div>'
      return
    }

    // Separa online e offline para mostrar online primeiro
    const sorted = [...screens].sort((a, b) => {
      const aOn = isScreenOnline(a) ? 1 : 0
      const bOn = isScreenOnline(b) ? 1 : 0
      return bOn - aOn
    })

    container.innerHTML = sorted.map(screen => {
      const online = isScreenOnline(screen)
      const lastSeen = formatLastSeen(screen.last_ping)

      return `
        <div class="status-item">
          <div class="status-indicator ${online ? 'online' : 'offline'}"></div>
          <div class="status-info">
            <div class="status-name">${escapeHtml(screen.name)}</div>
            <div class="status-time" style="color: ${online ? '#10B981' : '#A0AEC0'};">
              ${online ? '● ' + lastSeen : lastSeen}
            </div>
          </div>
          <div style="
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 20px;
            background: ${online ? 'rgba(16,185,129,0.1)' : 'rgba(160,174,192,0.1)'};
            color: ${online ? '#10B981' : '#718096'};
            white-space: nowrap;
          ">
            ${online ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      `
    }).join('')

  } catch (error) {
    console.error('❌ Erro no Status:', error)
    container.innerHTML = '<div style="text-align: center; color: #E53E3E;">Erro ao atualizar status</div>'
  }
}

// ==================== EVENTOS ====================

function setupEventListeners() {
  const btnRefresh = document.getElementById('btnRefreshStatus')
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.textContent = '⏳ Atualizando...'
      btnRefresh.disabled = true
      await loadRealtimeStatus()
      btnRefresh.textContent = '🔄 Atualizar'
      btnRefresh.disabled = false
    })
  }
}

// ==================== HELPERS ====================

function updateKPI(elementId, value) {
  const el = document.getElementById(elementId)
  if (el) el.innerText = value
}

function updateElement(elementId, text) {
  const el = document.getElementById(elementId)
  if (el) el.innerText = text
}

function formatDate(dateString) {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR')
}

function translatePriority(priority) {
  const map = { gold: 'Alta', silver: 'Média', bronze: 'Baixa' }
  return map[priority] || priority
}

console.log('✅ Dashboard.js carregado')
