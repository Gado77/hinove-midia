// ==================== LOGIN.JS (copiado para /public para deploy) ====================

// Configuração Supabase
const SUPABASE_URL = 'https://sxsmirhqbslmvyesikgg.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c21pcmhxYnNsbXZ5ZXNpa2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4NjMwOTYsImV4cCI6MjA3OTQzOTA5Nn0.ZLk6DAEfAZ2D451pGw1DO1h4oDIaZZgrgLOV6QUArB8'

const { createClient } = supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY)

// Elementos do DOM
const loginForm = document.getElementById('loginForm')
const emailInput = document.getElementById('email')
const passwordInput = document.getElementById('password')
const btnLogin = document.getElementById('btnLogin')
const btnText = document.getElementById('btnText')
const btnLoader = document.getElementById('btnLoader')
const errorMessage = document.getElementById('errorMessage')

console.log('Página de Login carregada e pronta.')

// Verificar se já está logado ao carregar a página
async function checkExistingLogin() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser()
    
    if (user) {
      console.log('Usuário já autenticado, redirecionando...')
      // Caminho relativo correto para quem está na raiz
      window.location.href = './src/dashboard/dashboard.html'
    }
  } catch (error) {
    console.error('Erro ao verificar login:', error)
  }
}

// Função para mostrar erro na tela
function showError(message) {
  console.error('Erro:', message)
  errorMessage.textContent = message
  errorMessage.style.display = 'block'
  
  // Remover erro automaticamente após 5 segundos
  setTimeout(() => {
    errorMessage.style.display = 'none'
  }, 5000)
}

// Função para validar formato de email
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

// Evento de Submit do formulário
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  
  const email = emailInput.value.trim()
  const password = passwordInput.value
  
  console.log('Tentando fazer login com:', email)

  // Validações de Campos
  if (!email || !password) {
    showError('Por favor, preencha todos os campos')
    return
  }

  if (!isValidEmail(email)) {
    showError('Por favor, insira um email válido')
    return
  }

  if (password.length < 6) {
    showError('A senha deve ter pelo menos 6 caracteres')
    return
  }

  // Estado de carregamento no botão
  btnLogin.disabled = true
  btnText.style.display = 'none'
  btnLoader.style.display = 'inline-block'
  errorMessage.style.display = 'none'

  try {
    console.log('Autenticando com Supabase...')

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    })

    if (authError) {
      if (authError.message.includes('Invalid login credentials')) {
        throw new Error('Email ou senha incorretos')
      } else if (authError.message.includes('Email not confirmed')) {
        throw new Error('Email não foi confirmado. Verifique seu email')
      } else {
        throw authError
      }
    }

    if (!authData.user) {
      throw new Error('Erro ao autenticar. Tente novamente')
    }

    console.log('Login bem-sucedido para:', authData.user.email)
    
    // Redirecionamento corrigido para dashboard.html
    setTimeout(() => {
      window.location.href = './src/dashboard/dashboard.html'
    }, 500)

  } catch (error) {
    console.error('Erro na autenticação:', error)
    
    let mensagem = error.message || 'Erro ao fazer login. Tente novamente'
    
    if (!navigator.onLine) {
      mensagem = 'Você está sem conexão com a internet'
    }
    
    showError(mensagem)
    
  } finally {
    // Restaurar estado do botão
    btnLogin.disabled = false
    btnText.style.display = 'inline'
    btnLoader.style.display = 'none'
  }
})

// Atalho: Enviar ao apertar Enter
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loginForm.dispatchEvent(new Event('submit'))
  }
})

// Limpar mensagens de erro quando o usuário focar nos campos novamente
emailInput.addEventListener('focus', () => {
  errorMessage.style.display = 'none'
})

passwordInput.addEventListener('focus', () => {
  errorMessage.style.display = 'none'
})

// Inicialização segura
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkExistingLogin)
} else {
  checkExistingLogin()
}
