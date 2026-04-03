/* ==================== SETTINGS.JS ====================
   Configurações enxutas: Organização, Clima, Segurança, Perigo
*/

let currentUser = null

document.addEventListener('DOMContentLoaded', async () => {
  try {
    currentUser = await checkAuth()
    if (!currentUser) return

    await loadSidebar('settings')
    setupTabs()
    setupEventListeners()
    await loadSettings()
    loadAccountInfo()

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao carregar configurações', 'error')
  }
})

// ==================== TABS ====================

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))

      btn.classList.add('active')
      document.getElementById(`tab-${tab}`).classList.add('active')
    })
  })
}

// ==================== CARREGAR DADOS ====================

async function loadSettings() {
  try {
    const { data: settings, error } = await apiSelect('settings', {
      eq: { user_id: currentUser.id }
    })

    if (error) throw error

    if (settings && settings.length > 0) {
      const s = settings[0]

      // Organização
      document.getElementById('orgName').value = s.organization_name || ''
      const logoUrl = s.organization_logo_url || ''
      document.getElementById('orgLogo').value = logoUrl
      if (logoUrl) showLogoPreview(logoUrl)

      // API Clima
      document.getElementById('apiWeather').value = s.api_weather_key || ''
    }

  } catch (error) {
    console.error('❌ Erro ao carregar settings:', error)
  }
}

function loadAccountInfo() {
  try {
    const user = supabaseClient.auth.getUser
      ? supabaseClient.auth.getUser()
      : null

    // Email
    const email = currentUser?.email || '—'
    document.getElementById('accountEmail').textContent = email

    // Data de criação
    const created = currentUser?.created_at
      ? new Date(currentUser.created_at).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'long', year: 'numeric'
        })
      : '—'
    document.getElementById('accountCreated').textContent = created

    // Último login
    const lastLogin = currentUser?.last_sign_in_at
      ? new Date(currentUser.last_sign_in_at).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '—'
    document.getElementById('accountLastLogin').textContent = lastLogin

  } catch (e) {
    console.warn('Não foi possível carregar info da conta')
  }
}

// ==================== SALVAR ORGANIZAÇÃO ====================

async function handleSaveOrganization(e) {
  e.preventDefault()

  const organization_name = document.getElementById('orgName').value.trim()
  const organization_logo_url = document.getElementById('orgLogo').value.trim()

  if (!organization_name) {
    showNotification('Informe o nome da organização', 'error')
    return
  }

  setLoading('#formOrganization button[type="submit"]', true)

  try {
    const { data: existing } = await apiSelect('settings', { eq: { user_id: currentUser.id } })

    if (existing && existing.length > 0) {
      await apiUpdate('settings', existing[0].id, { organization_name, organization_logo_url })
    } else {
      await apiInsert('settings', { organization_name, organization_logo_url }, currentUser.id)
    }

    if (organization_logo_url) showLogoPreview(organization_logo_url)
    showNotification('Organização salva! ✓', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao salvar', 'error')
  } finally {
    setLoading('#formOrganization button[type="submit"]', false, 'Salvar Organização')
  }
}

// ==================== LOGO PREVIEW ====================

function showLogoPreview(url) {
  const preview = document.getElementById('logoPreview')
  const img = document.getElementById('logoPreviewImg')
  img.src = url
  img.onload = () => { preview.style.display = 'flex' }
  img.onerror = () => { preview.style.display = 'none' }
}

// ==================== SALVAR API CLIMA ====================

async function handleSaveAPIs(e) {
  e.preventDefault()

  const api_weather_key = document.getElementById('apiWeather').value.trim()

  setLoading('#formAPIs button[type="submit"]', true)

  try {
    const { data: existing } = await apiSelect('settings', { eq: { user_id: currentUser.id } })

    if (existing && existing.length > 0) {
      await apiUpdate('settings', existing[0].id, { api_weather_key })
    } else {
      await apiInsert('settings', { api_weather_key }, currentUser.id)
    }

    showNotification('Chave de API salva! ✓', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao salvar chave', 'error')
  } finally {
    setLoading('#formAPIs button[type="submit"]', false, 'Salvar Chave')
  }
}

// ==================== TESTAR API CLIMA ====================

async function testWeatherApi() {
  const key = document.getElementById('apiWeather').value.trim()
  const statusEl = document.getElementById('apiWeatherStatus')

  if (!key) {
    showNotification('Cole sua chave antes de testar', 'error')
    return
  }

  statusEl.style.display = 'flex'
  statusEl.className = 'api-status'
  statusEl.querySelector('.status-text').textContent = 'Testando conexão...'

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=Sao+Paulo,BR&appid=${key}`
    )
    const data = await res.json()

    if (res.ok) {
      statusEl.classList.add('success')
      statusEl.querySelector('.status-text').textContent = '✓ Conexão bem-sucedida! API funcionando.'
    } else {
      statusEl.classList.add('error')
      statusEl.querySelector('.status-text').textContent = `✗ Erro: ${data.message || 'Chave inválida'}`
    }
  } catch (err) {
    statusEl.classList.add('error')
    statusEl.querySelector('.status-text').textContent = '✗ Erro de conexão. Verifique sua internet.'
  }
}

// ==================== ALTERAR SENHA ====================

async function handleChangePassword(e) {
  e.preventDefault()

  const currentPassword = document.getElementById('currentPassword').value
  const newPassword = document.getElementById('newPassword').value
  const confirmPassword = document.getElementById('confirmPassword').value

  if (!newPassword || newPassword.length < 8) {
    showNotification('A nova senha deve ter pelo menos 8 caracteres', 'error')
    return
  }

  if (newPassword !== confirmPassword) {
    showNotification('As senhas não coincidem', 'error')
    return
  }

  setLoading('#formPassword button[type="submit"]', true)

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword })

    if (error) throw error

    document.getElementById('formPassword').reset()
    document.getElementById('passwordStrength').style.display = 'none'
    showNotification('Senha alterada com sucesso! ✓', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification('Erro ao alterar senha: ' + error.message, 'error')
  } finally {
    setLoading('#formPassword button[type="submit"]', false, 'Alterar Senha')
  }
}

// ==================== FORÇA DA SENHA ====================

function checkPasswordStrength(password) {
  const strengthEl = document.getElementById('passwordStrength')
  const fillEl = document.getElementById('strengthFill')
  const labelEl = document.getElementById('strengthLabel')

  if (!password) {
    strengthEl.style.display = 'none'
    return
  }

  strengthEl.style.display = 'flex'

  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  const levels = [
    { label: 'Muito fraca', color: '#EF4444', width: '20%' },
    { label: 'Fraca',       color: '#F97316', width: '40%' },
    { label: 'Regular',     color: '#EAB308', width: '60%' },
    { label: 'Forte',       color: '#22C55E', width: '80%' },
    { label: 'Muito forte', color: '#10B981', width: '100%' },
  ]

  const level = levels[Math.min(score, 4)]
  fillEl.style.width = level.width
  fillEl.style.background = level.color
  labelEl.textContent = level.label
  labelEl.style.color = level.color
}

// ==================== TOGGLE SENHA VISÍVEL ====================

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId)
  const isPassword = input.type === 'password'
  input.type = isPassword ? 'text' : 'password'
  btn.style.color = isPassword ? 'var(--color-primary)' : 'var(--color-muted)'
}

// ==================== UTILITÁRIOS ====================

function handleClearCache() {
  if (!confirm('Limpar cache do navegador?')) return
  localStorage.clear()
  sessionStorage.clear()
  if ('caches' in window) {
    caches.keys().then(names => names.forEach(name => caches.delete(name)))
  }
  showNotification('Cache limpo! Recarregando...', 'success')
  setTimeout(() => window.location.reload(), 1200)
}

function handleLogout() {
  if (!confirm('Tem certeza que deseja sair?')) return
  supabaseClient.auth.signOut().then(() => {
    window.location.href = '/src/auth/login.html'
  })
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  document.getElementById('formOrganization')
    .addEventListener('submit', handleSaveOrganization)

  document.getElementById('formAPIs')
    .addEventListener('submit', handleSaveAPIs)

  document.getElementById('formPassword')
    .addEventListener('submit', handleChangePassword)

  document.getElementById('btnClearCache')
    .addEventListener('click', handleClearCache)

  document.getElementById('btnLogout')
    .addEventListener('click', handleLogout)

  // Preview ao sair do campo logo
  document.getElementById('orgLogo').addEventListener('blur', (e) => {
    if (e.target.value) showLogoPreview(e.target.value)
  })
}

console.log('✅ Settings.js carregado')
