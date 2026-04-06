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

function getBusinessHoursFromForm(prefix = '') {
  const businessHours = {}

  const weekdaysCheckbox = document.getElementById(prefix + 'Weekdays') || document.querySelector('[data-days-group="weekdays"]')
  const satCheckbox = document.getElementById(prefix + 'DaySat') || document.querySelector('[data-day-single="sat"]')
  const sunCheckbox = document.getElementById(prefix + 'DaySun') || document.querySelector('[data-day-single="sun"]')

  if (weekdaysCheckbox?.checked) {
    const day = 'wed'
    const open = document.querySelector(`[data-day="${day}"][data-turn="1_open"]`)?.value
    const close = document.querySelector(`[data-day="${day}"][data-turn="1_close"]`)?.value
    const hasTurn2 = document.getElementById(prefix + 'WeekdaysTurn2')?.checked
    
    if (open && close) {
      businessHours.mon = { open, close }
      businessHours.tue = { open, close }
      businessHours.wed = { open, close }
      businessHours.thu = { open, close }
      businessHours.fri = { open, close }
      
      if (hasTurn2) {
        const open2 = document.querySelector(`[data-day="${day}"][data-turn="2_open"]`)?.value
        const close2 = document.querySelector(`[data-day="${day}"][data-turn="2_close"]`)?.value
        if (open2 && close2) {
          businessHours.mon.turn2 = { open: open2, close: close2 }
          businessHours.tue.turn2 = { open: open2, close: close2 }
          businessHours.wed.turn2 = { open: open2, close: close2 }
          businessHours.thu.turn2 = { open: open2, close: close2 }
          businessHours.fri.turn2 = { open: open2, close: close2 }
        }
      }
    }
  }

  if (satCheckbox?.checked) {
    const open = document.querySelector('[data-day="sat"][data-turn="1_open"]')?.value
    const close = document.querySelector('[data-day="sat"][data-turn="1_close"]')?.value
    
    if (open && close) {
      businessHours.sat = { open, close }
    }
  }

  if (sunCheckbox?.checked) {
    const open = document.querySelector('[data-day="sun"][data-turn="1_open"]')?.value
    const close = document.querySelector('[data-day="sun"][data-turn="1_close"]')?.value
    if (open && close) {
      businessHours.sun = { open, close }
    }
  }

  return businessHours
}

async function handleCreateLocation(e) {
  e.preventDefault()

  const formData = {
    name: document.getElementById('locationName').value,
    address: document.getElementById('locationAddress').value,
    manager_name: document.getElementById('managerName').value,
    manager_phone: document.getElementById('managerPhone').value
  }

  const businessHours = getBusinessHoursFromForm()
  if (Object.keys(businessHours).length > 0) {
    formData.business_hours = businessHours
  }

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

    const bh = loc.business_hours || {}

    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri']
    const hasWeekdays = weekdays.some(d => bh[d])
    document.getElementById('editWeekdays').checked = hasWeekdays
    document.getElementById('editWeekdaysBody').classList.toggle('hidden', !hasWeekdays)
    
    if (hasWeekdays && bh.wed) {
      document.getElementById('edit_wed_1_open').value = bh.wed.open || ''
      document.getElementById('edit_wed_1_close').value = bh.wed.close || ''
      if (bh.wed.turn2) {
        document.getElementById('editWeekdaysTurn2').checked = true
        document.getElementById('edit_wed_2_open').value = bh.wed.turn2.open || ''
        document.getElementById('edit_wed_2_close').value = bh.wed.turn2.close || ''
      }
    }

    const hasSat = bh.sat
    document.getElementById('editDaySat').checked = hasSat
    document.getElementById('editSatBody').classList.toggle('hidden', !hasSat)
    if (hasSat) {
      document.getElementById('edit_sat_1_open').value = bh.sat.open || ''
      document.getElementById('edit_sat_1_close').value = bh.sat.close || ''
    }

    const hasSun = bh.sun
    document.getElementById('editDaySun').checked = !!hasSun
    document.getElementById('editSunBody').classList.toggle('hidden', !hasSun)
    if (hasSun) {
      document.getElementById('edit_sun_1_open').value = hasSun.open || ''
      document.getElementById('edit_sun_1_close').value = hasSun.close || ''
    }

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

  const businessHours = getBusinessHoursFromForm('edit')
  updates.business_hours = businessHours

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

function setupBusinessHoursToggle() {
  document.querySelectorAll('[data-days-group="weekdays"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const body = e.target.closest('.business-day-card').querySelector('.business-day-body')
      if (body) body.classList.toggle('hidden', !e.target.checked)
    })
  })
  
  document.querySelectorAll('[data-day-single]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const day = e.target.dataset.daySingle
      const card = e.target.closest('.business-day-card')
      const body = card.querySelector('.business-day-body')
      
      if (day === 'sun') {
        const status = card.querySelector('#editSunStatus') || card.querySelector('.sun-status')
        if (status) status.textContent = e.target.checked ? 'Aberto' : 'Fechado'
        return
      }
      
      if (body) body.classList.toggle('hidden', !e.target.checked)
    })
  })
  
  document.querySelectorAll('.has-turn2').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const card = e.target.closest('.business-day-card')
      const rows = card.querySelectorAll('.turn2-row')
      rows.forEach(row => row.classList.toggle('hidden', !e.target.checked))
    })
  })
}

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

  setupBusinessHoursToggle()

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