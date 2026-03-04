/* ==================== CAMPAIGNS.JS ====================
   Gerenciamento completo de Campanhas
   Bucket de Upload: 'medias'
   v2 - Compressão de imagem via canvas antes do upload
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
    
    if (createSelect) createSelect.innerHTML = options
    if (editSelect) editSelect.innerHTML = options
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
        <button class="btn-icon" onclick="openEditModal('${campaign.id}')" title="Editar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
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
    return '<div style="width:40px;height:40px;background:#eee;border-radius:4px;"></div>';
  }
  
  if (campaign.media_type === 'video') {
    return `<div style="width:40px;height:40px;background:#000;border-radius:4px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;">▶️</div>`
  }
  
  return `<img src="${campaign.media_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" onerror="this.src='https://via.placeholder.com/40'"/>`
}

// === COMPRESSÃO DE IMAGEM ===
/*
  Reduz imagens para no máximo 1280x720 (HD) antes do upload.
  - TV Box renderiza muito mais fácil arquivos menores
  - Qualidade JPEG: 0.82 (visualmente imperceptível, ~60-80% menor)
  - Vídeos são passados sem alteração
  - Retorna um novo File com o mesmo nome, pronto pro upload
*/
function compressImage(file, maxWidth = 1280, maxHeight = 720, quality = 0.82) {
  return new Promise((resolve) => {
    // Não é imagem? Devolve como veio
    if (!file.type.startsWith('image/')) {
      resolve(file)
      return
    }

    const reader = new FileReader()
    reader.readAsDataURL(file)

    reader.onload = (e) => {
      const img = new Image()
      img.src = e.target.result

      img.onload = () => {
        // Calcula proporção para não distorcer
        let { width, height } = img

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width  = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        // Desenha no canvas no novo tamanho
        const canvas = document.createElement('canvas')
        canvas.width  = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        // Exporta como JPEG comprimido (PNG vira JPEG aqui também — menor tamanho)
        canvas.toBlob((blob) => {
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now()
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

// === LÓGICA DE CRIAÇÃO (UPLOAD) ===

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
    // 1. Comprimir imagem antes do upload (vídeos passam direto)
    const fileToUpload = await compressImage(file)

    setLoading('#formNewCampaign button[type="submit"]', true, 'Enviando arquivo...')

    // 2. Preparar path no storage
    const fileExt = fileToUpload.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
    const filePath = `${currentUser.id}/${fileName}`

    // 3. Upload para o bucket 'medias'
    const { url, error: uploadError } = await apiUploadFile('medias', filePath, fileToUpload)
    if (uploadError) throw new Error('Erro no upload: ' + uploadError.message)

    console.log('✅ Arquivo enviado. URL:', url)

    // 4. Tipo de mídia
    const mediaType = file.type.startsWith('video/') ? 'video' : 'image'

    // 5. Salvar no banco
    const advertiser_id    = document.getElementById('campaignAdvertiser').value
    const priority         = document.getElementById('campaignPriority').value
    const start_date       = document.getElementById('campaignStartDate').value
    const end_date         = document.getElementById('campaignEndDate').value
    const duration_seconds = parseInt(document.getElementById('campaignDuration').value)

    const { error: dbError } = await apiInsert('campaigns', {
      advertiser_id,
      priority,
      start_date,
      end_date,
      duration_seconds,
      status: 'active',
      name: `Campanha ${new Date().toLocaleDateString()} - ${file.name}`,
      media_url: url,
      media_type: mediaType,
      file_path: filePath
    }, currentUser.id)

    if (dbError) throw dbError

    // 6. Sucesso
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
  } catch(e) { 
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

// === HELPERS E EVENTOS ===

function translateStatus(s) { 
  const m = {'active':'Ativa','paused':'Pausada','completed':'Concluída'}
  return m[s]||s 
}

function translatePriority(p) { 
  const m = {'gold':'Ouro','silver':'Prata','bronze':'Bronze'}
  return m[p]||p 
}

function formatDate(d) { 
  if(!d) return '-'
  return new Date(d).toLocaleDateString('pt-BR') 
}

function setupEventListeners() {
  setupModalHandlers('modalNewCampaign', 'btnOpenModal', 'btnCloseModal', 'btnCancelModal')
  setupModalHandlers('modalEditCampaign', null, 'btnCloseEditModal', 'btnCancelEditModal')
  
  document.getElementById('formNewCampaign').addEventListener('submit', handleCreateCampaign)
  document.getElementById('formEditCampaign').addEventListener('submit', handleEditCampaign)
  
  const searchInput  = document.getElementById('searchInput')
  const statusFilter = document.getElementById('statusFilter')
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => loadCampaigns(e.target.value, statusFilter.value), 500)
  })
  
  statusFilter.addEventListener('change', (e) => loadCampaigns(searchInput.value, e.target.value))
}
