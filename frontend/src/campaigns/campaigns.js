/* ==================== CAMPAIGNS.JS ====================
   Gerenciamento completo de Campanhas
   Bucket de Upload: 'medias'
   v3 - Upload em massa (múltiplos arquivos com preview e progresso)
*/

let currentUser = null
let searchTimeout = null

document.addEventListener('DOMContentLoaded', async () => {
  try {
    currentUser = await checkAuth()
    if (!currentUser) return

    await loadSidebar('campaigns')
    setupEventListeners()

    await Promise.all([
      loadCampaigns(),
      loadAdvertisersForSelect()
    ])

  } catch (error) {
    console.error('❌ Erro na inicialização:', error)
    showNotification('Erro ao carregar página', 'error')
  }
})

// === CARREGAMENTO DE DADOS ===

async function loadAdvertisersForSelect() {
  try {
    const { data: advertisers, error } = await apiSelect('advertisers', {
      userId: currentUser.id,
      select: 'id, name',
      order: { field: 'name', ascending: true }
    })

    if (error) throw error

    const options = advertisers && advertisers.length > 0
      ? '<option value="">Selecione um anunciante...</option>' +
        advertisers.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')
      : '<option value="">Nenhum anunciante cadastrado</option>'

    const createSelect = document.getElementById('campaignAdvertiser')
    const editSelect = document.getElementById('editCampaignAdvertiser')
    const bulkSelect = document.getElementById('bulkAdvertiser')

    if (createSelect) createSelect.innerHTML = options
    if (editSelect) editSelect.innerHTML = options
    if (bulkSelect) bulkSelect.innerHTML = options
  } catch (error) {
    console.error('Erro ao carregar anunciantes:', error)
  }
}

async function loadCampaigns(searchTerm = '', statusFilter = 'all') {
  const tbody = document.getElementById('campaignsList')
  try {
    let result
    if (searchTerm.trim()) {
      result = await apiSearch('campaigns', searchTerm, ['name'], currentUser.id)
    } else {
      result = await apiSelect('campaigns', {
        userId: currentUser.id,
        select: '*, advertisers (name)',
        order: { field: 'created_at', ascending: false }
      })
    }

    let { data: campaigns, error } = result
    if (error) throw error

    if (statusFilter !== 'all') {
      campaigns = campaigns?.filter(c => c.status === statusFilter) || []
    }
    renderCampaignsTable(campaigns)
  } catch (error) {
    console.error(error)
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red;">Erro ao carregar dados</td></tr>'
  }
}

function renderCampaignsTable(campaigns) {
  const tbody = document.getElementById('campaignsList')

  if (!campaigns || campaigns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: #718096;">Nenhuma campanha encontrada</td></tr>'
    return
  }

  tbody.innerHTML = campaigns.map(campaign => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${renderThumbnail(campaign)}
          <strong>${escapeHtml(campaign.name || 'Sem nome')}</strong>
        </div>
      </td>
      <td>${campaign.advertisers?.name || '-'}</td>
      <td><span class="status-badge ${campaign.status}">${translateStatus(campaign.status)}</span></td>
      <td><span class="priority-badge ${campaign.priority}">${translatePriority(campaign.priority)}</span></td>
      <td>${formatDate(campaign.start_date)} até ${formatDate(campaign.end_date)}</td>
      <td>${campaign.duration_seconds || '-'}s</td>
      <td style="text-align: right;">
        ${campaign.status === 'completed' ? `
        <button class="btn-icon" onclick="openReactivateModal('${campaign.id}')" title="Reativar" style="color: #10B981;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
        </button>
        ` : `
        <button class="btn-icon" onclick="openEditModal('${campaign.id}')" title="Editar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        `}
        <button class="btn-icon delete" onclick="deleteCampaign('${campaign.id}')" title="Excluir">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    </tr>
  `).join('')
}

function renderThumbnail(campaign) {
  if (!campaign.media_url) {
    return '<div style="width:40px;height:40px;background:#eee;border-radius:4px;"></div>'
  }
  if (campaign.media_type === 'video') {
    return `<div class="preview-thumbnail" onclick="openPreview('${campaign.media_url}', 'video', '${escapeHtml(campaign.name || 'Video')}')" style="width:40px;height:40px;background:#000;border-radius:4px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;">▶️</div>`
  }
  return `<img class="preview-thumbnail" src="${campaign.media_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" onclick="openPreview('${campaign.media_url}', 'image', '${escapeHtml(campaign.name || 'Imagem')}')" onerror="this.src='https://via.placeholder.com/40'"/>`
}

function openPreview(url, type, name) {
  const modal = document.getElementById('previewModal')
  const content = document.getElementById('previewContent')
  
  if (type === 'video') {
    content.innerHTML = `<video src="${url}" controls autoplay style="max-width:90vw;max-height:80vh;border-radius:8px;"></video>`
  } else {
    content.innerHTML = `<img src="${url}" alt="${name}" style="max-width:90vw;max-height:80vh;border-radius:8px;"/>`
  }
  
  modal.classList.add('active')
  document.body.style.overflow = 'hidden'
}

function closePreviewModal(event) {
  if (event.target.id === 'previewModal' || event.target.classList.contains('preview-modal-close') || event.currentTarget === event.target) {
    const modal = document.getElementById('previewModal')
    const content = document.getElementById('previewContent')
    modal.classList.remove('active')
    content.innerHTML = ''
    document.body.style.overflow = ''
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePreviewModal({ target: document.getElementById('previewModal'), currentTarget: document.getElementById('previewModal') })
  }
})

// === COMPRESSÃO DE IMAGEM ===
function compressImage(file, maxWidth = 1280, maxHeight = 720, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) { resolve(file); return }

    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target.result
      img.onload = () => {
        let { width, height } = img
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width  = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg', lastModified: Date.now()
          })
          const before = (file.size / 1024).toFixed(0)
          const after  = (compressed.size / 1024).toFixed(0)
          console.log(`🗜️ Compressão: ${before}KB → ${after}KB (${width}x${height})`)
          resolve(compressed)
        }, 'image/jpeg', quality)
      }
    }
  })
}

// ============================================================
// === UPLOAD EM MASSA ========================================
// ============================================================

// Estado do bulk upload
const BulkState = {
  files: [],        // Array de { file, id, status, error }
  isRunning: false
}

// Abre o modal de upload em massa
function openBulkModal() {
  BulkState.files = []
  BulkState.isRunning = false
  renderBulkFileList()
  updateBulkSummary()
  document.getElementById('modalBulkUpload').classList.add('active')
}

function closeBulkModal() {
  if (BulkState.isRunning) {
    if (!confirm('Upload em andamento. Deseja realmente cancelar?')) return
    BulkState.isRunning = false
  }
  document.getElementById('modalBulkUpload').classList.remove('active')
}

// Quando o usuário seleciona arquivos pela input
function onBulkFilesSelected(input) {
  const newFiles = Array.from(input.files)

  newFiles.forEach(file => {
    // Evita duplicatas pelo nome+tamanho
    const alreadyAdded = BulkState.files.some(
      f => f.file.name === file.name && f.file.size === file.size
    )
    if (!alreadyAdded) {
      BulkState.files.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        file,
        status: 'pending',   // pending | compressing | uploading | done | error
        progress: 0,
        error: null,
        previewUrl: null
      })
    }
  })

  // Reseta o input para permitir selecionar os mesmos arquivos de novo
  input.value = ''

  generatePreviews()
  renderBulkFileList()
  updateBulkSummary()
}

// Suporte a drag & drop na área do modal
function setupBulkDragDrop() {
  const zone = document.getElementById('bulkDropZone')
  if (!zone) return

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('dragover')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('dragover')
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    )
    files.forEach(file => {
      const alreadyAdded = BulkState.files.some(
        f => f.file.name === file.name && f.file.size === file.size
      )
      if (!alreadyAdded) {
        BulkState.files.push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          file,
          status: 'pending',
          progress: 0,
          error: null,
          previewUrl: null
        })
      }
    })
    generatePreviews()
    renderBulkFileList()
    updateBulkSummary()
  })
}

// Gera previews para imagens (vídeos mostram ícone)
function generatePreviews() {
  BulkState.files.forEach(entry => {
    if (entry.previewUrl) return
    if (entry.file.type.startsWith('image/')) {
      entry.previewUrl = URL.createObjectURL(entry.file)
    }
  })
}

// Remove um arquivo da fila
function removeBulkFile(id) {
  const idx = BulkState.files.findIndex(f => f.id === id)
  if (idx === -1) return
  const entry = BulkState.files[idx]
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
  BulkState.files.splice(idx, 1)
  renderBulkFileList()
  updateBulkSummary()
}

// Renderiza a lista de arquivos com preview e barra de progresso
function renderBulkFileList() {
  const container = document.getElementById('bulkFileList')
  if (!container) return

  if (BulkState.files.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:#718096;font-size:14px;">
        Nenhum arquivo selecionado ainda.<br>
        Use o botão acima ou arraste arquivos aqui.
      </div>`
    return
  }

  container.innerHTML = BulkState.files.map(entry => {
    const isVideo = entry.file.type.startsWith('video/')
    const sizeMB  = (entry.file.size / 1024 / 1024).toFixed(1)

    const preview = isVideo
      ? `<div style="width:56px;height:56px;background:#1A202C;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🎬</div>`
      : `<img src="${entry.previewUrl || ''}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0;" />`

    const statusIcon = {
      pending:     '⏳',
      compressing: '🗜️',
      uploading:   '⬆️',
      done:        '✅',
      error:       '❌'
    }[entry.status] || '⏳'

    const statusColor = {
      pending:     '#718096',
      compressing: '#D69E2E',
      uploading:   '#4299E1',
      done:        '#48BB78',
      error:       '#FC8181'
    }[entry.status] || '#718096'

    const progressBar = entry.status === 'uploading'
      ? `<div style="height:4px;background:#E2E8F0;border-radius:2px;margin-top:6px;overflow:hidden;">
           <div style="height:100%;width:${entry.progress}%;background:#4299E1;transition:width 0.3s;border-radius:2px;"></div>
         </div>`
      : entry.status === 'done'
        ? `<div style="height:4px;background:#48BB78;border-radius:2px;margin-top:6px;"></div>`
        : ''

    const canRemove = !BulkState.isRunning || entry.status === 'done' || entry.status === 'error'

    return `
      <div id="bulk-item-${entry.id}" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:#F7FAFC;border:1px solid #E2E8F0;margin-bottom:8px;">
        ${preview}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span style="font-size:13px;font-weight:600;color:#2D3748;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;" title="${escapeHtml(entry.file.name)}">
              ${escapeHtml(entry.file.name)}
            </span>
            <span style="font-size:11px;color:${statusColor};font-weight:600;white-space:nowrap;">
              ${statusIcon} ${entry.status === 'uploading' ? entry.progress + '%' : entry.status.toUpperCase()}
            </span>
          </div>
          <div style="font-size:12px;color:#718096;margin-top:2px;">${sizeMB} MB · ${isVideo ? 'Vídeo' : 'Imagem'}</div>
          ${entry.error ? `<div style="font-size:11px;color:#FC8181;margin-top:3px;">⚠️ ${entry.error}</div>` : ''}
          ${progressBar}
        </div>
        ${canRemove ? `
        <button onclick="removeBulkFile('${entry.id}')" title="Remover"
          style="background:none;border:none;cursor:pointer;color:#A0AEC0;padding:4px;border-radius:4px;flex-shrink:0;font-size:18px;line-height:1;"
          onmouseover="this.style.color='#FC8181'" onmouseout="this.style.color='#A0AEC0'">✕</button>
        ` : ''}
      </div>`
  }).join('')
}

// Atualiza o resumo no rodapé do modal
function updateBulkSummary() {
  const total    = BulkState.files.length
  const done     = BulkState.files.filter(f => f.status === 'done').length
  const errors   = BulkState.files.filter(f => f.status === 'error').length
  const pending  = BulkState.files.filter(f => f.status === 'pending').length

  const el = document.getElementById('bulkSummary')
  if (!el) return

  if (total === 0) {
    el.innerText = 'Nenhum arquivo na fila'
    return
  }

  const parts = [`Total: ${total}`]
  if (done)    parts.push(`✅ ${done} enviados`)
  if (errors)  parts.push(`❌ ${errors} erros`)
  if (pending) parts.push(`⏳ ${pending} aguardando`)
  el.innerText = parts.join(' · ')
}

// Atualiza o status de um item específico sem re-renderizar tudo
function updateBulkItemUI(entry) {
  // Re-renderiza só esse item inline para performance
  const container = document.getElementById('bulkFileList')
  if (!container) return
  renderBulkFileList() // simples por enquanto; pode ser otimizado por item se a lista for enorme
  updateBulkSummary()
}

// Processa todos os arquivos em fila (um a um para não sobrecarregar TV Box servidor)
async function startBulkUpload() {
  if (BulkState.isRunning) return
  if (BulkState.files.length === 0) {
    showNotification('Adicione arquivos antes de enviar', 'warning')
    return
  }

  // Valida campos obrigatórios
  const advertiser_id    = document.getElementById('bulkAdvertiser').value
  const priority         = document.getElementById('bulkPriority').value
  const start_date       = document.getElementById('bulkStartDate').value
  const end_date         = document.getElementById('bulkEndDate').value
  const duration_seconds = parseInt(document.getElementById('bulkDuration').value) || 10

  if (!start_date || !end_date) {
    showNotification('Preencha as datas de início e fim', 'warning')
    return
  }

  BulkState.isRunning = true

  const btn = document.getElementById('btnStartBulkUpload')
  if (btn) { btn.disabled = true; btn.innerText = 'Enviando...' }

  const pending = BulkState.files.filter(f => f.status === 'pending' || f.status === 'error')
  let successCount = 0
  let errorCount   = 0

  for (const entry of pending) {
    if (!BulkState.isRunning) break

    try {
      // --- Etapa 1: Compressão ---
      entry.status = 'compressing'
      entry.progress = 0
      updateBulkItemUI(entry)

      const fileToUpload = await compressImage(entry.file)

      // --- Etapa 2: Upload ---
      entry.status = 'uploading'
      entry.progress = 10
      updateBulkItemUI(entry)

      const fileExt  = fileToUpload.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
      const filePath = `${currentUser.id}/${fileName}`

      // Simula progresso visual durante upload (Supabase não expõe progresso real)
      const fakeProgressInterval = setInterval(() => {
        if (entry.progress < 85) {
          entry.progress += Math.floor(Math.random() * 12) + 3
          updateBulkItemUI(entry)
        }
      }, 300)

      const { url, error: uploadError } = await apiUploadFile('medias', filePath, fileToUpload)
      clearInterval(fakeProgressInterval)

      if (uploadError) throw new Error(uploadError.message || 'Erro no upload')

      entry.progress = 95
      updateBulkItemUI(entry)

      // --- Etapa 3: Salvar no banco ---
      const mediaType = entry.file.type.startsWith('video/') ? 'video' : 'image'
      const bulkCampaignName = document.getElementById('bulkCampaignName').value.trim()
      const campaignName = bulkCampaignName
        ? `${bulkCampaignName} - ${entry.file.name.replace(/\.[^.]+$/, '')}`
        : entry.file.name.replace(/\.[^.]+$/, '')

      const { error: dbError } = await apiInsert('campaigns', {
        advertiser_id: advertiser_id || null,
        priority,
        start_date,
        end_date,
        duration_seconds,
        status: 'active',
        name: campaignName,
        media_url: url,
        media_type: mediaType,
        file_path: filePath
      }, currentUser.id)

      if (dbError) throw dbError

      entry.status   = 'done'
      entry.progress = 100
      successCount++

    } catch (err) {
      entry.status = 'error'
      entry.error  = err.message || 'Erro desconhecido'
      errorCount++
      console.error(`❌ Erro no arquivo ${entry.file.name}:`, err)
    }

    updateBulkItemUI(entry)
  }

  BulkState.isRunning = false

  if (btn) {
    btn.disabled = false
    btn.innerText = errorCount > 0 ? '🔄 Tentar erros novamente' : '✅ Enviar tudo'
  }

  // Mensagem final
  if (successCount > 0 && errorCount === 0) {
    showNotification(`✅ ${successCount} arquivo(s) enviados com sucesso!`, 'success')
    loadCampaigns()
  } else if (successCount > 0 && errorCount > 0) {
    showNotification(`⚠️ ${successCount} enviados, ${errorCount} com erro`, 'warning')
    loadCampaigns()
  } else {
    showNotification(`❌ Todos os arquivos falharam`, 'error')
  }

  updateBulkSummary()
}

// ============================================================
// === UPLOAD ÚNICO (mantido igual ao v2) =====================
// ============================================================

async function handleCreateCampaign(e) {
  e.preventDefault()

  const fileInput = document.getElementById('campaignMedia')
  const file = fileInput.files[0]

  if (!file) {
    showNotification('Selecione uma imagem ou vídeo', 'warning')
    return
  }

  setLoading('#formNewCampaign button[type="submit"]', true, 'Comprimindo...')

  try {
    const fileToUpload = await compressImage(file)
    setLoading('#formNewCampaign button[type="submit"]', true, 'Enviando arquivo...')

    const fileExt = fileToUpload.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
    const filePath = `${currentUser.id}/${fileName}`

    const { url, error: uploadError } = await apiUploadFile('medias', filePath, fileToUpload)
    if (uploadError) throw new Error('Erro no upload: ' + uploadError.message)

    const mediaType = file.type.startsWith('video/') ? 'video' : 'image'

    const campaignName = document.getElementById('campaignName').value.trim()
    const { error: dbError } = await apiInsert('campaigns', {
      advertiser_id:    document.getElementById('campaignAdvertiser').value,
      priority:         document.getElementById('campaignPriority').value,
      start_date:       document.getElementById('campaignStartDate').value,
      end_date:         document.getElementById('campaignEndDate').value,
      duration_seconds: parseInt(document.getElementById('campaignDuration').value),
      status: 'active',
      name: campaignName,
      media_url: url,
      media_type: mediaType,
      file_path: filePath
    }, currentUser.id)

    if (dbError) throw dbError

    document.getElementById('modalNewCampaign').classList.remove('active')
    document.getElementById('formNewCampaign').reset()
    loadCampaigns()
    showNotification('Campanha criada com sucesso!', 'success')

  } catch (error) {
    console.error('❌ Erro:', error)
    showNotification(error.message, 'error')
  } finally {
    setLoading('#formNewCampaign button[type="submit"]', false, 'Salvar Campanha')
  }
}

// === LÓGICA DE EDIÇÃO E EXCLUSÃO ===

async function openEditModal(campaignId) {
  try {
    const { data: campaigns } = await apiSelect('campaigns', { eq: { id: campaignId } })
    if (!campaigns || !campaigns[0]) return
    const c = campaigns[0]

    document.getElementById('editCampaignId').value = c.id
    document.getElementById('editCampaignName').value = c.name || ''
    document.getElementById('editCampaignAdvertiser').value = c.advertiser_id || ''
    document.getElementById('editCampaignStatus').value = c.status
    document.getElementById('editCampaignPriority').value = c.priority
    document.getElementById('editCampaignStartDate').value = c.start_date
    document.getElementById('editCampaignEndDate').value = c.end_date
    document.getElementById('editCampaignDuration').value = c.duration_seconds

    document.getElementById('modalEditCampaign').classList.add('active')
  } catch (e) { console.error(e) }
}

async function handleEditCampaign(e) {
  e.preventDefault()

  const id = document.getElementById('editCampaignId').value
  const updates = {
    name:             document.getElementById('editCampaignName').value.trim(),
    advertiser_id:    document.getElementById('editCampaignAdvertiser').value,
    status:           document.getElementById('editCampaignStatus').value,
    priority:         document.getElementById('editCampaignPriority').value,
    start_date:       document.getElementById('editCampaignStartDate').value,
    end_date:         document.getElementById('editCampaignEndDate').value,
    duration_seconds: parseInt(document.getElementById('editCampaignDuration').value)
  }

  setLoading('#formEditCampaign button[type="submit"]', true)

  try {
    await apiUpdate('campaigns', id, updates)
    document.getElementById('modalEditCampaign').classList.remove('active')
    loadCampaigns()
    showNotification('Atualizado!', 'success')
  } catch (e) {
    showNotification('Erro ao atualizar', 'error')
  } finally {
    setLoading('#formEditCampaign button[type="submit"]', false, 'Salvar Alterações')
  }
}

async function deleteCampaign(id) {
  if (!confirm('Excluir esta campanha?')) return
  try {
    await apiDelete('campaigns', id)
    loadCampaigns()
    showNotification('Excluído!', 'success')
  } catch (e) { showNotification('Erro ao excluir', 'error') }
}

async function openReactivateModal(campaignId) {
  try {
    const { data: campaigns } = await apiSelect('campaigns', { eq: { id: campaignId } })
    if (!campaigns || !campaigns[0]) return
    const c = campaigns[0]

    document.getElementById('reactivateCampaignId').value = c.id
    document.getElementById('reactivateCampaignName').textContent = c.name || 'esta campanha'

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    document.getElementById('reactivateEndDate').value = tomorrow.toISOString().split('T')[0]
    document.getElementById('reactivateEndDate').min = new Date().toISOString().split('T')[0]

    document.getElementById('modalReactivate').classList.add('active')
  } catch (e) { console.error(e) }
}

async function handleReactivateCampaign(e) {
  e.preventDefault()

  const id = document.getElementById('reactivateCampaignId').value
  const newEndDate = document.getElementById('reactivateEndDate').value

  setLoading('#formReactivate button[type="submit"]', true)

  try {
    await apiUpdate('campaigns', id, {
      status: 'active',
      end_date: newEndDate
    })
    document.getElementById('modalReactivate').classList.remove('active')
    loadCampaigns()
    showNotification('Campanha reativada!', 'success')
  } catch (e) {
    showNotification('Erro ao reativar', 'error')
  } finally {
    setLoading('#formReactivate button[type="submit"]', false, 'Reativar')
  }
}

// === HELPERS E EVENTOS ===

function translateStatus(s) {
  const m = { active: 'Ativa', paused: 'Pausada', completed: 'Concluída' }
  return m[s] || s
}

function translatePriority(p) {
  const m = { gold: 'Ouro', silver: 'Prata', bronze: 'Bronze' }
  return m[p] || p
}

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('pt-BR')
}

function setupEventListeners() {
  setupModalHandlers('modalNewCampaign', 'btnOpenModal', 'btnCloseModal', 'btnCancelModal')
  setupModalHandlers('modalEditCampaign', null, 'btnCloseEditModal', 'btnCancelEditModal')
  setupModalHandlers('modalReactivate', null, 'btnCloseReactivate', 'btnCancelReactivate')

  document.getElementById('formNewCampaign').addEventListener('submit', handleCreateCampaign)
  document.getElementById('formEditCampaign').addEventListener('submit', handleEditCampaign)
  document.getElementById('formReactivate').addEventListener('submit', handleReactivateCampaign)

  // Botão de upload em massa
  const btnBulk = document.getElementById('btnOpenBulkModal')
  if (btnBulk) btnBulk.addEventListener('click', openBulkModal)

  // Fechar modal bulk
  const btnCloseBulk = document.getElementById('btnCloseBulkModal')
  if (btnCloseBulk) btnCloseBulk.addEventListener('click', closeBulkModal)

  // Input de arquivos bulk
  const bulkInput = document.getElementById('bulkMediaInput')
  if (bulkInput) bulkInput.addEventListener('change', (e) => onBulkFilesSelected(e.target))

  // Botão iniciar upload
  const btnStart = document.getElementById('btnStartBulkUpload')
  if (btnStart) btnStart.addEventListener('click', startBulkUpload)

  // Drag & drop
  setupBulkDragDrop()

  const searchInput  = document.getElementById('searchInput')
  const statusFilter = document.getElementById('statusFilter')

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => loadCampaigns(e.target.value, statusFilter.value), 500)
  })

  statusFilter.addEventListener('change', (e) => loadCampaigns(searchInput.value, e.target.value))
}
