/* ==================== UTILS.JS ====================
   Funções compartilhadas entre todas as páginas
   Dependências: config.js (Supabase)
*/

// ==================== 1. CARREGAMENTO DA SIDEBAR ====================

async function loadSidebar(activePage) {
  try {
    const container = document.getElementById('sidebar-container')
    if (!container) {
      console.error('❌ Elemento #sidebar-container não encontrado')
      return
    }

    const response = await fetch('/frontend/src/shared/sidebar.html')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    container.innerHTML = await response.text()

    // Marca link ativo
    if (activePage) {
      container.querySelector(`.nav-item[data-page="${activePage}"]`)?.classList.add('active')
    }

    // Logout
    document.getElementById('btnLogout')?.addEventListener('click', handleLogout)

    // Dados do usuário
    updateSidebarUserInfo()

    // Injeta responsividade mobile em todas as páginas
    _injectMobileMenu()

  } catch (error) {
    console.error('❌ Erro ao carregar sidebar:', error)
    const container = document.getElementById('sidebar-container')
    if (container) {
      container.innerHTML = `
        <div style="padding:20px;color:red;background:#fee;border-radius:8px;margin:10px;">
          <strong>Erro ao carregar menu:</strong> ${error.message}
        </div>`
    }
  }
}

// ==================== 2. INJEÇÃO DO MOBILE MENU ====================

function _injectMobileMenu() {
  // CSS
  if (!document.getElementById('mobile-menu-css')) {
    const link = document.createElement('link')
    link.id   = 'mobile-menu-css'
    link.rel  = 'stylesheet'
    link.href = '/frontend/src/shared/mobile-menu.css'
    document.head.appendChild(link)
  }
  // JS
  if (!document.getElementById('mobile-menu-js')) {
    const script = document.createElement('script')
    script.id  = 'mobile-menu-js'
    script.src = '/frontend/src/shared/mobile-menu.js'
    document.body.appendChild(script)
  }
}

// ==================== 3. AUTENTICAÇÃO ====================

async function checkAuth() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      window.location.href = '/frontend/src/auth/login.html'
      return null
    }
    return user
  } catch (error) {
    window.location.href = '/frontend/src/auth/login.html'
    return null
  }
}

// ==================== 4. USUÁRIO NA SIDEBAR ====================

async function updateSidebarUserInfo() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) return
    const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário'
    const nameEl   = document.getElementById('userName')
    const emailEl  = document.getElementById('userEmail')
    const avatarEl = document.getElementById('avatar')
    if (nameEl)   nameEl.textContent  = name
    if (emailEl)  emailEl.textContent = user.email
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase()
  } catch (e) { console.error('❌ Erro sidebar user:', e) }
}

// ==================== 5. LOGOUT ====================

async function handleLogout() {
  try {
    await supabaseClient.auth.signOut()
    window.location.href = '/frontend/src/auth/login.html'
  } catch (error) {
    alert('Erro ao sair. Tente novamente.')
  }
}

// ==================== 6. NOTIFICAÇÕES ====================

function showNotification(message, type = 'info', duration = 3500) {
  let container = document.getElementById('notifications-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'notifications-container'
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      max-width: 380px;
      min-width: 260px;
    `
    document.body.appendChild(container)
  }

  const colors = {
    success: { bg:'#DEF7EC', border:'#10B981', text:'#03543F', icon:'✅' },
    error:   { bg:'#FEE2E2', border:'#EF4444', text:'#7F1D1D', icon:'❌' },
    warning: { bg:'#FEF3C7', border:'#F59E0B', text:'#92400E', icon:'⚠️' },
    info:    { bg:'#EFF6FF', border:'#3B82F6', text:'#0C2340', icon:'ℹ️' },
  }
  const c = colors[type] || colors.info

  const n = document.createElement('div')
  n.style.cssText = `
    background:${c.bg};border-left:4px solid ${c.border};color:${c.text};
    padding:12px 16px;border-radius:8px;margin-bottom:10px;font-size:14px;
    font-weight:500;display:flex;align-items:flex-start;gap:8px;
    box-shadow:0 4px 14px rgba(0,0,0,0.1);animation:slideInNotif 0.3s ease-out;
  `
  n.innerHTML = `<span>${c.icon}</span><span>${message}</span>`
  container.appendChild(n)

  setTimeout(() => {
    n.style.animation = 'slideOutNotif 0.3s ease-out'
    setTimeout(() => n.remove(), 300)
  }, duration)
}

// Keyframes notificações
if (!document.getElementById('notif-kf')) {
  const s = document.createElement('style')
  s.id = 'notif-kf'
  s.textContent = `
    @keyframes slideInNotif  { from{transform:translateX(420px);opacity:0} to{transform:translateX(0);opacity:1} }
    @keyframes slideOutNotif { from{transform:translateX(0);opacity:1} to{transform:translateX(420px);opacity:0} }
    @keyframes spin          { to{transform:rotate(360deg)} }
  `
  document.head.appendChild(s)
}

// ==================== 7. UTILITÁRIOS ====================

function escapeHtml(text) {
  if (!text) return ''
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
}

console.log('✅ Utils carregado')
