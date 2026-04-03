// ==================== LOGIN.JS ====================

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

console.log('Página de Login carregada')

// Verificar se já está logado
async function checkExistingLogin() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser()
    
    if (user) {
      console.log('Usuário já autenticado, redirecionando...')
      window.location.href = '/src/dashboard/dashboard.html'
    }
  } catch (error) {
    console.error('Erro ao verificar login:', error)
  }
}

// Função para mostrar erro
function showError(message) {
  console.error('Erro:', message)
  errorMessage.textContent = message
  errorMessage.style.display = 'block'
  
  // Remover erro após 5 segundos
  setTimeout(() => {
    errorMessage.style.display = 'none'
  }, 5000)
}

// Função para validar email
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

// Submit do formulário
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  
  const email = emailInput.value.trim()
  const password = passwordInput.value
  
  console.log('Tentando fazer login com:', email)

  // Validações
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

  // Desabilitar botão e mostrar loader
  btnLogin.disabled = true
  btnText.style.display = 'none'
  btnLoader.style.display = 'inline'
  errorMessage.style.display = 'none'

  try {
    console.log('Autenticando com Supabase...')

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    })

    if (authError) {
      // Erros comuns do Supabase
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

    console.log('Login bem-sucedido!')
    console.log('Usuário:', authData.user.email)
    
    // Pequeno delay antes de redirecionar
    setTimeout(() => {
      window.location.href = '/src/dashboard/dashboard.html'
    }, 500)

  } catch (error) {
    console.error('Erro na autenticação:', error)
    
    // Mensagem amigável ao usuário
    let mensagem = error.message || 'Erro ao fazer login. Tente novamente'
    
    // Se for erro de rede
    if (!navigator.onLine) {
      mensagem = 'Você está sem conexão com a internet'
    }
    
    showError(mensagem)
    
  } finally {
    // Reabilitar botão
    btnLogin.disabled = false
    btnText.style.display = 'inline'
    btnLoader.style.display = 'none'
  }
})

// Entrar com tecla Enter
passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loginForm.dispatchEvent(new Event('submit'))
  }
})

// Limpar erros ao digitar
emailInput.addEventListener('focus', () => {
  errorMessage.style.display = 'none'
})

passwordInput.addEventListener('focus', () => {
  errorMessage.style.display = 'none'
})

// Verificar login ao carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkExistingLogin)
} else {
  checkExistingLogin()
}