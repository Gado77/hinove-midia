/* ==================== LOCATIONS.JS ====================
   Gerenciamento de Locais (CRUD com API Helpers)
   Muito mais limpo e eficiente
*/

let currentUser = null
let searchTimeout = null

// ==================== INICIALIZAÇÃO ====================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Autenticação
    currentUser = await checkAuth()
    if (!currentUser) return

    // 2. Sidebar
    await loadSidebar('locations')

    // 3. Setup
    setupEventListeners()

    // 4. Carregar dados
    loadLocations()

  } catch (error) {
    console.error('❌ Erro na inicialização:', error)
    showNotification('Erro ao carregar página', 'error')
  }
})

// ==================== CARREGAMENTO ====================

async function loadLocations(searchTerm = '') {
  const tbody = document.getElementById('locationsList')

  try {
    let result

    if (searchTerm.trim()) {
      // Busca com termo
      result = await apiSearch(
        'locations',
        searchTerm,
        ['name', 'address', 'manager_name'],
        currentUser.id
      )
    } else {
      // Carrega todos
      result = await apiSelect('locations', {
        userId: currentUser.id,
        select: '*, screens(count)',
        order: { field: 'created_at', ascending: false }
      })
    }

    const { data: locations, error } = result

    if (error) throw error

    renderLocationsTable(locations)

  } catch (error) {
    console.error('❌ Erro ao carregar:', error)
    tbody.innerHTML = `<tr><td colspan="6" style="color: #E53E3E; text-align: center;">Erro ao carregar dados</td></tr>`
  }
}

function renderLocationsTable(locations) {
  const tbody = document.getElementById('locationsList')

  if (!locations || locations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: #718096;">Nenhum local cadastrado</td></tr>`
    return
  }

  tbody.innerHTML = locations.map(loc => {
    const screenCount = loc.screens?.[0]?.count || 0
    const badgeClass = screenCount > 0 ? 'online' : 'offline'
    const badgeText = screenCount === 1 ? '1 Tela' : `${screenCount} Telas`

    return `
      <tr>
        <td><strong>${escapeHtml(loc.name)}</strong></td>
        <td>${loc.address ? escapeHtml(loc.address) : '<span style="color: #CBD5E0;">-</span>'}</td>
        <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
        <td>${loc.manager_name ? escapeHtml(loc.manager_name) : '-'}</td>
        <td>${loc.manager_phone ? formatPhone(loc.manager_phone) : '-'}</td>
        <td style="text-align: right;">
          <button class="btn-icon" onclick="openEditModal('${loc.id}')" title="Editar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-icon delete" onclick="deleteLocation('${loc.id}')" title="Excluir">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      </tr>
    `
  }).join('')
}

// ==================== CRIAR ====================

async function handleCreateLocation(e) {
  e.preventDefault()

  const hours1Open = document.getElementById('locationHours1Open').value
  const hours1Close = document.getElementById('locationHours1Close').value
  const hours2Open = document.getElementById('locationHours2Open').value
  const hours2Close = document.getElementById('locationHours2Close').value

  const daysCheckboxes = document.querySelectorAll('input[name="business_days"]:checked')
  const businessDays = Array.from(daysCheckboxes).map(cb => cb.value)

  const formData = {
    name: document.getElementById('locationName').value,
    address: document.getElementById('locationAddress').value,
    manager_name: document.getElementById('managerName').value,
    manager_phone: document.getElementById('managerPhone').value
  }

  if (businessDays.length > 0) formData.business_days = businessDays
  if (hours1Open) formData.business_hours_1_open = hours1Open
  if (hours1Close) formData.business_hours_1_close = hours1Close
  if (hours2Open) formData.business_hours_2_open = hours2Open
  if (hours2Close) formData.business_hours_2_close = hours2Close

  setLoading('button[type="submit"]', true)

  try {
    const { data, error } = await apiInsert('locations', formData, currentUser.id)

    if (error) throw error

    document.getElementById('modalNewLocation').classList.remove('active')
    resetForm('formNewLocation')
    loadLocations()
    showNotification('Local cadastrado com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao criar local', 'error')
  } finally {
    setLoading('button[type="submit"]', false, 'Salvar Local')
  }
}

// ==================== EDITAR ====================

async function openEditModal(locationId) {
  try {
    const { data: location, error } = await apiSelect('locations', {
      eq: { id: locationId }
    })

    if (error || !location || location.length === 0) throw new Error('Local não encontrado')

    const loc = location[0]

    document.getElementById('editLocationId').value = loc.id
    document.getElementById('editLocationName').value = loc.name
    document.getElementById('editLocationAddress').value = loc.address || ''
    document.getElementById('editManagerName').value = loc.manager_name || ''
    document.getElementById('editManagerPhone').value = loc.manager_phone || ''
    document.getElementById('editLocationHours1Open').value = loc.business_hours_1_open ? loc.business_hours_1_open.substring(0, 5) : ''
    document.getElementById('editLocationHours1Close').value = loc.business_hours_1_close ? loc.business_hours_1_close.substring(0, 5) : ''
    document.getElementById('editLocationHours2Open').value = loc.business_hours_2_open ? loc.business_hours_2_open.substring(0, 5) : ''
    document.getElementById('editLocationHours2Close').value = loc.business_hours_2_close ? loc.business_hours_2_close.substring(0, 5) : ''

    const days = loc.business_days || ['mon','tue','wed','thu','fri','sat']
    document.getElementById('editDayMon').checked = days.includes('mon')
    document.getElementById('editDayTue').checked = days.includes('tue')
    document.getElementById('editDayWed').checked = days.includes('wed')
    document.getElementById('editDayThu').checked = days.includes('thu')
    document.getElementById('editDayFri').checked = days.includes('fri')
    document.getElementById('editDaySat').checked = days.includes('sat')
    document.getElementById('editDaySun').checked = days.includes('sun')

    document.getElementById('modalEditLocation').classList.add('active')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao caregar local', 'error')
  }
}

async function handleEditLocation(e) {
  e.preventDefault()

  const id = document.getElementById('editLocationId').value
  const updates = {
    name: document.getElementById('editLocationName').value,
    address: document.getElementById('editLocationAddress').value,
    manager_name: document.getElementById('editManagerName').value,
    manager_phone: document.getElementById('editManagerPhone').value
  }

  const hours1Open = document.getElementById('editLocationHours1Open').value
  const hours1Close = document.getElementById('editLocationHours1Close').value
  const hours2Open = document.getElementById('editLocationHours2Open').value
  const hours2Close = document.getElementById('editLocationHours2Close').value

  const dayInputs = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const selectedDays = dayInputs
    .filter(d => document.getElementById(`editDay${d}`).checked)
    .map(d => d.toLowerCase().replace('tue', 'tue').replace('thu', 'thu'))

  if (selectedDays.length > 0) updates.business_days = selectedDays

  if (hours1Open) updates.business_hours_1_open = hours1Open
  if (hours1Close) updates.business_hours_1_close = hours1Close
  if (hours2Open) updates.business_hours_2_open = hours2Open
  if (hours2Close) updates.business_hours_2_close = hours2Close

  setLoading('button[type="submit"]', true)

  try {
    const { error } = await apiUpdate('locations', id, updates)

    if (error) throw error

    document.getElementById('modalEditLocation').classList.remove('active')
    loadLocations()
    showNotification('Local atualizado com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao atualizar local', 'error')
  } finally {
    setLoading('button[type="submit"]', false, 'Salvar Alterações')
  }
}

// ==================== DELETAR ====================

async function deleteLocation(id) {
  if (!confirm('Tem certeza que deseja excluir este local?')) return

  try {
    const { error } = await apiDelete('locations', id)

    if (error) {
      if (error.code === '23503') {
        showNotification('Não é possível deletar: existem telas vinculadas', 'warning')
      } else {
        throw error
      }
      return
    }

    loadLocations()
    showNotification('Local excluído com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao excluir local', 'error')
  }
}

// ==================== EVENTOS ====================

function setupEventListeners() {
  // Modal - Criar
  setupModalHandlers(
    'modalNewLocation',
    'btnOpenModal',
    'btnCloseModal',
    'btnCancelModal'
  )

  // Modal - Editar
  setupModalHandlers(
    'modalEditLocation',
    null,
    'btnCloseEditModal',
    'btnCancelEditModal'
  )

  // Form - Criar
  const formNew = document.getElementById('formNewLocation')
  if (formNew) formNew.addEventListener('submit', handleCreateLocation)

  // Form - Editar
  const formEdit = document.getElementById('formEditLocation')
  if (formEdit) formEdit.addEventListener('submit', handleEditLocation)

  // Busca
  const searchInput = document.getElementById('searchInput')
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => loadLocations(e.target.value), 500)
    })
  }
}

// ==================== UTILITÁRIOS ====================

function formatPhone(v) {
  if (!v) return ''
  v = v.replace(/\D/g, '')
  v = v.replace(/^(\d{2})(\d)/g, '($1) $2')
  v = v.replace(/(\d)(\d{4})$/, '$1-$2')
  return v
}

console.log('✅ Locations.js carregado')