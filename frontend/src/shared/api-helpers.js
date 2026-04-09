/* ==================== API-HELPERS.JS ====================
   Funções CRUD genéricas para todas as páginas
   Reduz 80% do código repetido
   Dependências: config.js
*/

// ==================== 1. SELECT (LEITURA) ====================

async function apiSelect(table, options = {}) {
  try {
    const {
      select = '*',
      eq = {},           // { field: value }
      order = null,      // { field: 'name', ascending: true }
      limit = null,
      userId = null      // Se precisar filtrar por user_id
    } = options

    let query = supabaseClient.from(table).select(select)

    // Filtro automático por user_id se fornecido
    if (userId) {
      query = query.eq('user_id', userId)
    }

    // Filtros customizados
    for (const [field, value] of Object.entries(eq)) {
      if (value !== null && value !== undefined) {
        query = query.eq(field, value)
      }
    }

    // Ordenação
    if (order) {
      query = query.order(order.field, { ascending: order.ascending !== false })
    }

    // Limite
    if (limit) {
      query = query.limit(limit)
    }

    const { data, error } = await query

    if (error) throw error
    return { data, error: null }

  } catch (error) {
    console.error(`❌ Erro ao ler ${table}:`, error)
    return { data: null, error }
  }
}

// ==================== 2. INSERT (CRIAÇÃO) ====================

async function apiInsert(table, records, userId = null) {
  try {
    // Garante que é um array
    const recordsArray = Array.isArray(records) ? records : [records]

    // Adiciona user_id automaticamente se fornecido
    if (userId) {
      recordsArray.forEach(record => {
        if (!record.user_id) record.user_id = userId
      })
    }

    const { data, error } = await supabaseClient
      .from(table)
      .insert(recordsArray)
      .select()

    if (error) throw error
    return { data, error: null }

  } catch (error) {
    console.error(`❌ Erro ao criar em ${table}:`, error)
    return { data: null, error }
  }
}

// ==================== 3. UPDATE (ATUALIZAÇÃO) ====================

async function apiUpdate(table, id, updates) {
  try {
    const { data, error } = await supabaseClient
      .from(table)
      .update(updates)
      .eq('id', id)
      .select()

    if (error) throw error
    return { data, error: null }

  } catch (error) {
    console.error(`❌ Erro ao atualizar ${table}:`, error)
    return { data: null, error }
  }
}

// ==================== 4. DELETE (EXCLUSÃO) ====================

async function apiDelete(table, id) {
  try {
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .eq('id', id)

    if (error) throw error
    return { error: null }

  } catch (error) {
    console.error(`❌ Erro ao deletar de ${table}:`, error)
    return { error }
  }
}

// ==================== 5. SEARCH (BUSCA AVANÇADA) ====================

async function apiSearch(table, searchTerm, searchFields, userId = null) {
  try {
    if (!searchTerm || searchTerm.trim() === '') {
      return apiSelect(table, { userId })
    }

    let query = supabaseClient.from(table).select('*')

    if (userId) {
      query = query.eq('user_id', userId)
    }

    // Busca em múltiplos campos
    const filters = searchFields
      .map(field => `${field}.ilike.%${searchTerm}%`)
      .join(',')

    query = query.or(filters)

    const { data, error } = await query

    if (error) throw error
    return { data, error: null }

  } catch (error) {
    console.error(`❌ Erro ao buscar em ${table}:`, error)
    return { data: null, error }
  }
}

// ==================== 6. UPLOAD DE ARQUIVO (Cloudflare R2) ====================

async function apiUploadFile(bucket, filePath, file) {
  try {
    // Pega o token JWT da sessão atual
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) throw new Error("Não autenticado")

    // Chama o Cloudflare Worker que configuramos
    const response = await fetch(`${CLOUDFLARE_WORKER_URL}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: file,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Upload falhou no Worker")
    }

    const result = await response.json()
    return { url: result.url, error: null }

  } catch (error) {
    console.error(`❌ Erro ao fazer upload no R2:`, error)
    return { url: null, error }
  }
}

// ==================== 6B. DELETE DE ARQUIVO ====================

async function apiDeleteFile(bucket, fileUrl) {
  if (!fileUrl) return { error: null }
  
  try {
    const urlParts = fileUrl.split('/')
    // No R2 protegemos os arquivos do usuario dentro do diretorio ID Dele
    // Precisamos de user_id/nome_do_arquivo.jpg
    const workerFilePath = `${urlParts[urlParts.length - 2]}/${urlParts[urlParts.length - 1].split('?')[0]}`

    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) throw new Error("Não autenticado")
    
    // Deleta o arquivo no Worker Cloudflare R2
    await fetch(`${CLOUDFLARE_WORKER_URL}/delete`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ path: workerFilePath })
    })
    
    return { error: null }
    
  } catch (error) {
    console.warn(`⚠️ Aviso: falha ao deletar arquivo fisico em R2:`, error)
    return { error }
  }
}

// ==================== 6C. DELETE DE MÚLTIPLOS ARQUIVOS ====================

async function apiDeleteFiles(bucket, fileUrls) {
  if (!fileUrls || fileUrls.length === 0) return { error: null }
  
  const fileNames = fileUrls.map(url => {
    if (!url) return null
    const urlParts = url.split('/')
    return urlParts[urlParts.length - 1].split('?')[0]
  }).filter(Boolean)
  
  if (fileNames.length === 0) return { error: null }
  
  try {
    const { error } = await supabaseClient.storage
      .from(bucket)
      .remove(fileNames)
    
    if (error) {
      console.warn(`⚠️ Erro ao deletar arquivos:`, error)
    }
    return { error }
    
  } catch (error) {
    console.warn(`⚠️ Erro ao deletar arquivos:`, error)
    return { error }
  }
}

// ==================== 7. HELPERS DE RENDERIZAÇÃO ====================

function renderTable(tbody, data, columns, actions = []) {
  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${columns.length + 1}" style="text-align: center; padding: 40px; color: #718096;">
          Nenhum registro encontrado.
        </td>
      </tr>`
    return
  }

  tbody.innerHTML = data.map(row => {
    const cells = columns.map(col => {
      const value = row[col.field]
      if (col.format) return col.format(value, row)
      return `<td>${escapeHtml(value || '-')}</td>`
    }).join('')

    const actionButtons = actions.map(action => `
      <button 
        class="btn-icon ${action.class || ''}" 
        onclick="${action.onClick}('${row.id}')" 
        title="${action.title}"
      >
        ${action.icon}
      </button>
    `).join('')

    return `<tr>${cells}<td style="text-align: right;">${actionButtons}</td></tr>`
  }).join('')
}

function renderEmpty(elementId, message = 'Nenhum dado disponível') {
  const el = document.getElementById(elementId)
  if (el) {
    el.innerHTML = `<div style="text-align: center; padding: 40px; color: #718096;">${message}</div>`
  }
}

// ==================== 8. MODAL HELPERS ====================

function setupModalHandlers(modalId, openBtnId, closeBtnId, cancelBtnId) {
  const modal = document.getElementById(modalId)
  if (!modal) return

  const openBtn = openBtnId ? document.getElementById(openBtnId) : null
  const closeBtn = document.getElementById(closeBtnId)
  const cancelBtn = document.getElementById(cancelBtnId)

  const openModal = () => modal.classList.add('active')
  const closeModal = () => modal.classList.remove('active')

  if (openBtn) openBtn.addEventListener('click', openModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal)

  // Fecha ao clicar no fundo
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal()
  })
}

// ==================== 9. FORM HELPERS ====================

function getFormData(formId) {
  const form = document.getElementById(formId)
  if (!form) return {}

  const formData = new FormData(form)
  const data = {}

  for (const [key, value] of formData.entries()) {
    data[key] = value
  }

  return data
}

function resetForm(formId) {
  const form = document.getElementById(formId)
  if (form) form.reset()
}

// ==================== 10. LOADING STATE ====================

function setLoading(buttonSelector, isLoading, text = 'Salvando...') {
  const btn = document.querySelector(buttonSelector)
  if (!btn) return

  const originalText = btn.dataset.originalText || btn.innerText

  if (isLoading) {
    btn.dataset.originalText = originalText
    btn.innerText = text
    btn.disabled = true
  } else {
    btn.innerText = originalText
    btn.disabled = false
  }
}

console.log('✅ API Helpers carregado com sucesso') 