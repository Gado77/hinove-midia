/* ==================== SCREENS.JS ====================
   Gerenciamento completo de Telas (CRUD)
   Dependências: config.js, utils.js, api-helpers.js
*/

let currentUser = null
let searchTimeout = null
let screensData = []

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Autenticação
    currentUser = await checkAuth()
    if (!currentUser) return

    // 2. Sidebar
    await loadSidebar('screens')

    // 3. Setup
    setupEventListeners()

    // 4. Carregar dados
    await Promise.all([
      loadScreens(),
      loadLocationsForSelect(),
      loadPlaylistsForSelect()
    ])

  } catch (error) {
    console.error('❌ Erro na inicialização:', error)
    showNotification('Erro ao carregar página', 'error')
  }
})

// ==================== CARREGAR DADOS AUXILIARES ====================

async function loadLocationsForSelect() {
  try {
    const { data: locations, error } = await apiSelect('locations', {
      userId: currentUser.id,
      select: 'id, name',
      order: { field: 'name', ascending: true }
    })

    if (error) throw error

    const options = locations && locations.length > 0
      ? '<option value="">Selecione um local...</option>' + 
        locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')
      : '<option value="">Nenhum local cadastrado</option>'

    const createSelect = document.getElementById('screenLocation')
    const editSelect = document.getElementById('editScreenLocation')

    if (createSelect) createSelect.innerHTML = options
    if (editSelect) editSelect.innerHTML = options

  } catch (error) {
    console.error('❌ Erro ao carregar locais:', error)
    showNotification('Erro ao carregar locais', 'error')
  }
}

async function loadPlaylistsForSelect() {
  try {
    const { data: playlists, error } = await apiSelect('playlists', {
      userId: currentUser.id,
      select: 'id, name',
      order: { field: 'name', ascending: true }
    })

    if (error) throw error

    const options = (playlists && playlists.length > 0)
      ? '<option value="">Selecione uma playlist...</option>' + 
        playlists.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">Nenhuma playlist criada</option>'

    // Popula o select do modal de EDIÇÃO
    const editSelect = document.getElementById('editScreenPlaylist')
    if (editSelect) editSelect.innerHTML = options

    // Popula o select do modal de CRIAÇÃO (NOVO)
    const newSelect = document.getElementById('newScreenPlaylist')
    if (newSelect) newSelect.innerHTML = options

  } catch (error) {
    console.error('❌ Erro ao carregar playlists:', error)
  }
}

// ==================== CARREGAR TELAS ====================

async function loadScreens(searchTerm = '', statusFilter = 'all') {
  const tbody = document.getElementById('screensList')

  try {
    let result

    if (searchTerm.trim()) {
      result = await apiSearch(
        'screens',
        searchTerm,
        ['name', 'device_id'],
        currentUser.id
      )
    } else {
      result = await apiSelect('screens', {
        userId: currentUser.id,
        select: '*, locations (name), playlists (name)',
        order: { field: 'created_at', ascending: false }
      })
    }

    let { data: screens, error } = result

    if (error) throw error

    // Filtro de status via JavaScript
    if (statusFilter !== 'all') {
      screens = screens?.filter(s => s.status === statusFilter) || []
    }

    // Se buscou e filtrou, fazer busca nos locais também
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      screens = screens?.filter(screen => {
        const locationName = screen.locations?.name ? screen.locations.name.toLowerCase() : ''
        return locationName.includes(term)
      }) || screens
    }

    screensData = screens || []
    renderScreensTable(screensData)

  } catch (error) {
    console.error('❌ Erro ao carregar telas:', error)
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #E53E3E; padding: 20px;">Erro ao carregar dados</td></tr>'
  }
}

function renderScreensTable(screens) {
  const tbody = document.getElementById('screensList')

  if (!screens || screens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #718096;">Nenhuma tela encontrada</td></tr>'
    return
  }

  tbody.innerHTML = screens.map(screen => {
    const isOnline = isScreenOnline(screen)
    const lastSeen = formatLastSeen(screen.last_ping)
    const onlineTime = formatOnlineTime(screen.last_ping)
    
    return `
    <tr>
      <td>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <span class="status-badge ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
          ${isOnline ? `<span style="font-size: 10px; color: #48BB78;">🟢 ${onlineTime}</span>` : `<span style="font-size: 10px; color: #A0AEC0;">Visto: ${lastSeen}</span>`}
        </div>
      </td>
      <td>
        <strong>${escapeHtml(screen.name)}</strong>
        <div style="font-size: 11px; color: #A0AEC0;">${screen.orientation === 'landscape' ? '🖥️ Horizontal' : '📱 Vertical'}</div>
      </td>
      <td>
        ${screen.locations?.name 
          ? `<span style="color:#2D3748; font-weight:500;">📍 ${escapeHtml(screen.locations.name)}</span>` 
          : '<span style="color:#CBD5E0;">Sem local</span>'}
      </td>
      <td>
        <div style="font-weight: 500; font-size: 13px; color: #3182CE; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(screen.current_content || '')}">
          ${screen.current_content ? '▶️ ' + escapeHtml(screen.current_content) : '<span style="color: #CBD5E0;">Parado</span>'}
        </div>
      </td>
      <td>
        ${screen.playlists?.name 
          ? `<span style="color:#2D3748;">${escapeHtml(screen.playlists.name)}</span>` 
          : '<span style="color: #CBD5E0;">Nenhuma</span>'}
      </td>
      <td>
        <span style="font-size: 11px; color: #718096;">${lastSeen}</span>
      </td>
      <td style="text-align: right;">
        <button class="btn-icon" onclick="openDiagnosticsModal('${screen.id}')" title="Diagnóstico" style="background: #EBF8FF; border-color: #90CDF4;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3182CE" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </button>
        <button class="btn-icon" onclick="openEditModal('${screen.id}')" title="Editar Tela">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="btn-icon delete" onclick="deleteScreen('${screen.id}')" title="Excluir">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    </tr>
  `}).join('')
}

// ==================== FUNÇÕES DE DIAGNÓSTICO ====================

function isScreenOnline(screen) {
  if (!screen.last_ping) return false
  const lastPing = new Date(screen.last_ping).getTime()
  return (Date.now() - lastPing) < (2 * 60 * 1000) // 2 minutos
}

function formatLastSeen(lastPing) {
  if (!lastPing) return 'Nunca'
  const date = new Date(lastPing)
  const now = new Date()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  
  if (diffMin < 1) return 'Agora'
  if (diffMin < 60) return `Há ${diffMin}min`
  if (diffMin < 1440) return `Há ${Math.floor(diffMin / 60)}h`
  return date.toLocaleDateString('pt-BR')
}

function formatOnlineTime(lastPing) {
  if (!lastPing) return 'Offline'
  const date = new Date(lastPing)
  const now = new Date()
  const diffMs = now - date
  const diffSec = Math.floor(diffMs / 1000)
  
  if (diffSec < 60) return `${diffSec}s online`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}min online`
  const diffHrs = Math.floor(diffMin / 60)
  return `${diffHrs}h ${diffMin % 60}min online`
}

async function openDiagnosticsModal(screenId) {
  const screen = screensData.find(s => s.id === screenId)
  if (!screen) return
  
  currentScreenIdForCommand = screenId
  const isOnline = isScreenOnline(screen)
  const lastSeen = formatLastSeen(screen.last_ping)
  const onlineTime = formatOnlineTime(screen.last_ping)
  
  // Mostra modal com dados
  document.getElementById('diagScreenName').textContent = screen.name
  document.getElementById('diagDeviceId').textContent = screen.device_id || 'PENDENTE'
  document.getElementById('diagStatus').innerHTML = isOnline 
    ? '<span style="color:#48BB78;">🟢 Online</span>' 
    : '<span style="color:#FC8181;">🔴 Offline</span>'
  document.getElementById('diagOnlineTime').textContent = onlineTime
  document.getElementById('diagLastSeen').textContent = lastSeen
  document.getElementById('diagLocation').textContent = screen.locations?.name || 'Não definido'
  document.getElementById('diagPlaylist').textContent = screen.playlists?.name || 'Nenhuma playlist'
  document.getElementById('diagOrientation').textContent = 
    screen.orientation === 'landscape' ? '🖥️ Horizontal' : '📱 Vertical'
  
  // Novos campos de monitoramento
  document.getElementById('diagCurrentContent').textContent = screen.current_content || 'Aguardando...'
  document.getElementById('diagPlaylistCount').textContent = screen.playlist_items_count 
    ? `${screen.playlist_items_count} itens` 
    : '0 itens'
  
  // Cache Progress Bar
  const cacheUsed = screen.cache_used_mb || 0
  const cacheLimit = 500 // 500MB é o limite configurado no Android
  const cachePercent = Math.min(100, Math.round((cacheUsed / cacheLimit) * 100))
  document.getElementById('diagCacheBar').style.width = `${cachePercent}%`
  document.getElementById('diagCacheUsed').textContent = `${cacheUsed} MB / ${cacheLimit} MB`
  
  // Update buttons
  const btnPause = document.getElementById('btnPauseResume')
  if (screen.is_paused) {
    btnPause.innerHTML = '▶️ Retomar'
    btnPause.classList.remove('btn-secondary')
    btnPause.classList.add('btn-primary')
  } else {
    btnPause.innerHTML = '⏸️ Pausar'
    btnPause.classList.add('btn-secondary')
    btnPause.classList.remove('btn-primary')
  }

  // Status badge no modal
  const statusBadge = document.getElementById('diagStatusBadge')
  statusBadge.className = `status-badge ${isOnline ? 'online' : 'offline'}`
  statusBadge.textContent = isOnline ? 'ONLINE' : 'OFFLINE'
  
  document.getElementById('modalDiagnostics').classList.add('active')
}

let currentScreenIdForCommand = null

async function sendCommand(command, payload = "") {
  if (!currentScreenIdForCommand) {
    showNotification('Erro: tela não selecionada', 'error')
    return
  }

  try {
    const { error } = await apiInsert('screen_commands', {
      screen_id: currentScreenIdForCommand,
      command: command,
      payload: payload,
      status: 'pending'
    })

    if (error) throw error
    showNotification(`Comando '${command}' enviado! A TV recebe em até 30s.`, 'success')
  } catch (error) {
    console.error('Erro ao enviar comando:', error)
    showNotification('Falha ao enviar comando.', 'error')
  }
}

async function forceRefreshFromModal() {
  await sendCommand('refresh', 'force')
}

async function togglePauseResume() {
  const screen = screensData.find(s => s.id === currentScreenIdForCommand)
  if (!screen) return
  
  const isCurrentlyPaused = screen.is_paused || false
  const command = isCurrentlyPaused ? 'resume' : 'pause'
  
  await sendCommand(command)
  
  // Atualiza o estado local para feedback imediato no UI
  screen.is_paused = !isCurrentlyPaused
  const btn = document.getElementById('btnPauseResume')
  if (screen.is_paused) {
    btn.innerHTML = '▶️ Retomar'
    btn.classList.remove('btn-secondary')
    btn.classList.add('btn-primary')
  } else {
    btn.innerHTML = '⏸️ Pausar'
    btn.classList.add('btn-secondary')
    btn.classList.remove('btn-primary')
  }
}

function closeDiagnosticsModal() {
  document.getElementById('modalDiagnostics').classList.remove('active')
}

// ==================== CRIAR TELA (COM PLAYLIST) ====================

async function handleCreateScreen(e) {
  e.preventDefault()

  const device_id = document.getElementById('screenDeviceId').value.trim().toUpperCase()
  const name = document.getElementById('screenName').value
  const location_id = document.getElementById('screenLocation').value
  const active_playlist_id = document.getElementById('newScreenPlaylist').value || null
  const orientation = document.getElementById('screenOrientation').value
  const is_muted = document.getElementById('screenMuted').checked

  if (!device_id) {
    showNotification('Código de pareamento é obrigatório', 'warning')
    return
  }

  if (!location_id) {
    showNotification('Localização é obrigatória', 'warning')
    return
  }

  setLoading('#formNewScreen button[type="submit"]', true)

  try {
    // Verifica se ID já existe
    const { data: existing } = await apiSelect('screens', {
      eq: { device_id: device_id }
    })

    if (existing && existing.length > 0) {
      throw new Error('Este código de tela já está cadastrado!')
    }

    const { data, error } = await apiInsert('screens', {
      name,
      location_id,
      orientation,
      device_id,
      active_playlist_id,
      is_muted,
      status: 'offline'
    }, currentUser.id)

    if (error) throw error

    document.getElementById('modalNewScreen').classList.remove('active')
    document.getElementById('formNewScreen').reset()
    loadScreens()
    showNotification('Tela vinculada e salva com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification(error.message || 'Erro ao criar tela', 'error')
  } finally {
    setLoading('#formNewScreen button[type="submit"]', false, 'Vincular Tela')
  }
}

// ==================== EDITAR TELA (SALVAR CONFIGURAÇÕES) ====================

async function openEditModal(screenId) {
  try {
    const { data: screens, error } = await apiSelect('screens', {
      eq: { id: screenId }
    })

    if (error || !screens || screens.length === 0) throw new Error('Tela não encontrada')

    const screen = screens[0]

    document.getElementById('editScreenId').value = screen.id
    document.getElementById('editScreenDeviceId').value = screen.device_id || ''
    document.getElementById('editScreenName').value = screen.name
    document.getElementById('editScreenOrientation').value = screen.orientation
    document.getElementById('editScreenLocation').value = screen.location_id || ''
    document.getElementById('editScreenPlaylist').value = screen.active_playlist_id || ''
    document.getElementById('editScreenMuted').checked = screen.is_muted || false

    document.getElementById('modalEditScreen').classList.add('active')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao carregar tela', 'error')
  }
}

async function handleEditScreen(e) {
  e.preventDefault()

  const id = document.getElementById('editScreenId').value
  const name = document.getElementById('editScreenName').value
  const location_id = document.getElementById('editScreenLocation').value
  const orientation = document.getElementById('editScreenOrientation').value
  const active_playlist_id = document.getElementById('editScreenPlaylist').value || null
  const is_muted = document.getElementById('editScreenMuted').checked

  if (!location_id) {
    showNotification('Localização é obrigatória', 'warning')
    return
  }

  setLoading('#formEditScreen button[type="submit"]', true)

  try {
    const { error } = await apiUpdate('screens', id, {
      name,
      location_id,
      orientation,
      active_playlist_id,
      is_muted
    })

    if (error) throw error

    document.getElementById('modalEditScreen').classList.remove('active')
    loadScreens()
    showNotification('Configurações da tela salvas!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao atualizar tela', 'error')
  } finally {
    setLoading('#formEditScreen button[type="submit"]', false, 'Salvar Alterações')
  }
}

// ==================== DELETAR TELA ====================

async function deleteScreen(id) {
  if (!confirm('Tem certeza que deseja excluir esta tela? Esta ação é irreversível e o player será desconectado.')) return

  try {
    const { error } = await apiDelete('screens', id)

    if (error) throw error

    loadScreens()
    showNotification('Tela excluída com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao excluir tela', 'error')
  }
}

// ==================== EVENTOS ====================

function setupEventListeners() {
  // Modals
  setupModalHandlers('modalNewScreen', 'btnOpenModal', 'btnCloseModal', 'btnCancelModal')
  setupModalHandlers('modalEditScreen', null, 'btnCloseEditModal', 'btnCancelEditModal')

  // Forms
  document.getElementById('formNewScreen').addEventListener('submit', handleCreateScreen)
  document.getElementById('formEditScreen').addEventListener('submit', handleEditScreen)

  // Filtros
  const searchInput = document.getElementById('searchInput')
  const statusFilter = document.getElementById('statusFilter')

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      loadScreens(e.target.value, statusFilter.value)
    }, 500)
  })

  statusFilter.addEventListener('change', (e) => {
    loadScreens(searchInput.value, e.target.value)
  })
}

// ==================== LOG VIEWER ====================

async function openLogViewer() {
  const screen = screensData.find(s => s.id === currentScreenIdForCommand)
  if (!screen) return

  document.getElementById('logScreenName').textContent = screen.name
  document.getElementById('modalLogs').classList.add('active')
  refreshLogs()
}

function closeLogViewer() {
  document.getElementById('modalLogs').classList.remove('active')
}

async function refreshLogs() {
  const logList = document.getElementById('logList')
  logList.innerHTML = '<div style="padding: 40px; text-align: center; color: #718096;"><div class="spinner-small"></div> Carregando logs...</div>'

  try {
    const { data: logs, error } = await apiSelect('player_logs', {
      eq: { screen_id: currentScreenIdForCommand },
      order: { field: 'created_at', ascending: false },
      limit: 50
    })

    if (error) throw error

    if (!logs || logs.length === 0) {
      logList.innerHTML = '<div style="padding: 40px; text-align: center; color: #718096;">Nenhum log encontrado para esta tela.</div>'
      return
    }

    logList.innerHTML = logs.map(log => {
      const time = new Date(log.created_at).toLocaleTimeString('pt-BR')
      const typeClass = log.event_type.includes('error') ? 'error' : 
                        log.event_type.includes('start') ? 'start' : 
                        log.event_type.includes('command') ? 'command' : ''
      
      return `
        <div class="log-entry">
          <span class="log-time">${time}</span>
          <span class="log-type ${typeClass}">${log.event_type}</span>
          <span class="log-msg">${escapeHtml(log.message || '')}</span>
        </div>
      `
    }).join('')

  } catch (error) {
    console.error('Erro ao carregar logs:', error)
    logList.innerHTML = '<div style="padding: 40px; text-align: center; color: #E53E3E;">Erro ao carregar logs.</div>'
  }
}

// ==================== PLAYLIST PREVIEW ====================

async function loadPlaylistPreview(playlistId) {
  const container = document.getElementById('playlistPreviewContainer')
  const list = document.getElementById('playlistPreviewList')

  if (!playlistId) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  list.innerHTML = '<div style="padding: 20px; text-align: center; color: #718096;"><div class="spinner-small"></div> Carregando preview...</div>'

  try {
    const { data: items, error } = await apiSelect('playlist_items', {
      eq: { playlist_id: playlistId },
      select: '*, campaigns(name, media_type), dynamic_contents(name, content_type)',
      order: { field: 'display_order', ascending: true }
    })

    if (error) throw error

    if (!items || items.length === 0) {
      list.innerHTML = '<div style="padding: 20px; text-align: center; color: #718096;">Playlist vazia</div>'
      return
    }

    list.innerHTML = items.map((item, index) => {
      const name = item.campaigns?.name || item.dynamic_contents?.name || 'Item sem nome'
      const type = item.campaigns ? (item.campaigns.media_type === 'video' ? '📹 Vídeo' : '🖼️ Imagem') : 
                   item.dynamic_contents ? `🧩 ${item.dynamic_contents.content_type}` : '❓ Desconhecido'
      const duration = item.duration || (item.campaigns ? 'Auto' : '15s')

      return `
        <div style="padding: 10px 15px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #EDF2F7; background: white;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-weight: bold; color: #CBD5E0; font-size: 12px;">${index + 1}</span>
            <div>
              <div style="font-size: 13px; font-weight: 600; color: #2D3748;">${escapeHtml(name)}</div>
              <div style="font-size: 10px; color: #718096;">${type}</div>
            </div>
          </div>
          <div style="font-size: 11px; font-weight: 600; color: #3182CE; background: #EBF8FF; padding: 2px 8px; border-radius: 4px;">
            ${duration}s
          </div>
        </div>
      `
    }).join('')

  } catch (error) {
    console.error('Erro ao carregar preview:', error)
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #E53E3E;">Erro ao carregar preview</div>'
  }
}

console.log('✅ Screens.js carregado')
