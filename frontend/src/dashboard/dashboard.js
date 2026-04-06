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
      loadRealtimeStatus(),
      loadAlerts()
    ])

    setupEventListeners()

    // Auto-atualiza o status a cada 30s (mesma frequência do ping da TV)
    setInterval(() => {
      loadRealtimeStatus()
      loadAlerts()
    }, 30000)

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

// ==================== SISTEMA DE NOTIFICAÇÕES ====================

let notifications = []

function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown')
  dropdown.classList.toggle('active')
}

document.addEventListener('click', (e) => {
  const bell = document.getElementById('notificationBell')
  const dropdown = document.getElementById('notificationDropdown')
  if (!bell.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.remove('active')
  }
})

function clearAllNotifications() {
  notifications = []
  renderNotifications()
}

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function isWithinBusinessHours(businessDays, hours1Open, hours1Close, hours2Open, hours2Close) {
  const now = new Date()
  const currentDay = DAY_MAP[now.getDay()]
  const currentTime = now.getHours() * 60 + now.getMinutes()

  if (!businessDays || !businessDays.includes(currentDay)) {
    return false
  }
  
  const parseTime = (t) => {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  const t1Open = parseTime(hours1Open)
  const t1Close = parseTime(hours1Close)
  const t2Open = parseTime(hours2Open)
  const t2Close = parseTime(hours2Close)

  if (currentTime >= t1Open && currentTime < t1Close) {
    return true
  }

  if (t2Open && t2Close) {
    if (currentTime >= t2Open && currentTime < t2Close) {
      return true
    }
  }

  return false
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return ''
  
  const now = Date.now()
  const diff = now - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (days > 0) {
    const remainingHours = hours % 24
    return remainingHours > 0 
      ? `${days} dia${days > 1 ? 's' : ''} e ${remainingHours}h`
      : `${days} dia${days > 1 ? 's' : ''}`
  }
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0
      ? `${hours}h e ${remainingMinutes}min`
      : `${hours}h`
  }
  
  return `${minutes}min`
}

function formatBusinessHours(hours1Open, hours1Close, hours2Open, hours2Close) {
  const fmt = (t) => {
    if (!t) return null
    const [h] = t.split(':').map(Number)
    return `${h}h`
  }
  
  let text = `${fmt(hours1Open)} às ${fmt(hours1Close)}`
  if (hours2Open && hours2Close) {
    text += ` e ${fmt(hours2Open)} às ${fmt(hours2Close)}`
  }
  return text
}

function formatDays(days) {
  if (!days || days.length === 0) return 'Sem dias definidos'
  
  const dayNames = {
    mon: 'Seg', tue: 'Ter', wed: 'Qua', thu: 'Qui', fri: 'Sex', sat: 'Sáb', sun: 'Dom'
  }
  
  if (days.length === 7) return 'Todos os dias'
  
  const mapped = days.map(d => dayNames[d] || d).sort((a, b) => {
    const order = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    return order.indexOf(a) - order.indexOf(b)
  })
  
  return mapped.join(', ')
}

function renderNotifications() {
  const badge = document.getElementById('notificationBadge')
  const count = document.getElementById('notificationCount')
  const list = document.getElementById('notificationList')
  const footer = document.getElementById('notificationFooter')

  if (notifications.length === 0) {
    badge.style.display = 'none'
    count.textContent = '0'
    list.innerHTML = `
      <div class="notification-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <p>Nenhuma notificação</p>
      </div>
    `
    footer.style.display = 'none'
    return
  }

  badge.style.display = 'flex'
  badge.textContent = notifications.length > 99 ? '99+' : notifications.length
  count.textContent = notifications.length
  footer.style.display = 'block'

  list.innerHTML = notifications.map(n => `
    <div class="notification-item">
      <div class="notification-icon ${n.type}">
        ${n.type === 'danger' ? '🔴' : n.type === 'warning' ? '⚠️' : 'ℹ️'}
      </div>
      <div class="notification-content">
        <div class="notification-title">${escapeHtml(n.title)}</div>
        <div class="notification-message">${n.message}</div>
        ${n.time ? `<div class="notification-time">${n.time}</div>` : ''}
      </div>
    </div>
  `).join('')
}

async function loadNotifications() {
  try {
    notifications = []
    const now = Date.now()
    const FIFTEEN_MINS = 15 * 60 * 1000
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

    // 1. Busca telas com local para checar horários
    const { data: screens } = await apiSelect('screens', {
      userId: currentUser.id,
      select: 'id, name, last_ping, playlist_items_count, active_playlist_id, locations(business_days, business_hours_1_open, business_hours_1_close, business_hours_2_open, business_hours_2_close, name)'
    })

    if (screens) {
      screens.forEach(s => {
        const isOnline = s.last_ping && (now - new Date(s.last_ping).getTime()) <= FIFTEEN_MINS
        const location = s.locations
        const hasBusinessHours = location && (location.business_hours_1_open || location.business_hours_2_open)
        const businessDays = location?.business_days || ['mon','tue','wed','thu','fri','sat']

        // Tela Offline há mais de 15 min
        if (s.last_ping) {
          const lastPing = new Date(s.last_ping).getTime()
          if (now - lastPing > FIFTEEN_MINS) {
            notifications.push({
              type: 'danger',
              title: 'Tela Desconectada',
              message: `A tela <strong>${escapeHtml(s.name)}</strong> está offline há ${formatTimeAgo(s.last_ping)}.`,
              time: formatTimeAgo(s.last_ping)
            })
          }
        }

        // Horário de funcionamento
        if (isOnline && hasBusinessHours && location) {
          const withinHours = isWithinBusinessHours(
            businessDays,
            location.business_hours_1_open,
            location.business_hours_1_close,
            location.business_hours_2_open,
            location.business_hours_2_close
          )
          const hoursText = formatBusinessHours(
            location.business_hours_1_open,
            location.business_hours_1_close,
            location.business_hours_2_open,
            location.business_hours_2_close
          )
          const daysText = formatDays(businessDays)
          
          if (!withinHours) {
            notifications.push({
              type: 'warning',
              title: 'Fora do Horário',
              message: `<strong>${escapeHtml(s.name)}</strong> está ligada fora do horário de funcionamento.`,
              time: `${daysText} • ${hoursText}`
            })
          }
        }
      })
    }

    // 2. Busca telas sem playlist_items_count (pode não estar sincronizado)
    const { data: allScreens } = await apiSelect('screens', {
      userId: currentUser.id,
      select: 'id, name, active_playlist_id, playlist_items_count'
    })

    if (allScreens) {
      allScreens.forEach(s => {
        if (s.active_playlist_id && s.playlist_items_count === 0) {
          notifications.push({
            type: 'warning',
            title: 'Playlist Vazia',
            message: `A tela <strong>${escapeHtml(s.name)}</strong> possui playlist vinculada mas sem itens.`
          })
        }
      })
    }

    // 3. Campanhas vencendo em breve
    const threeDaysFromNow = new Date(now + THREE_DAYS).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]

    const { data: campaigns } = await apiSelect('campaigns', {
      userId: currentUser.id,
      select: 'id, name, end_date',
      eq: { status: 'active' }
    })

    if (campaigns) {
      campaigns.forEach(c => {
        if (c.end_date >= today && c.end_date <= threeDaysFromNow) {
          const daysUntil = Math.ceil((new Date(c.end_date).getTime() - now) / 86400000)
          let timeText = daysUntil === 1 ? 'amanhã' : `em ${daysUntil} dias`
          notifications.push({
            type: 'info',
            title: 'Campanha Expirando',
            message: `<strong>${escapeHtml(c.name || 'Sem nome')}</strong> encerra ${timeText}.`,
            time: formatDate(c.end_date)
          })
        }
      })
    }

    renderNotifications()

  } catch (error) {
    console.error('❌ Erro ao carregar notificações:', error)
  }
}

// Mantém compatibilidade com código antigo
async function loadAlerts() {
  await loadNotifications()
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
