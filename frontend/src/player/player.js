/* ==================== PLAYER.JS (FINAL v6.5 - PERFORMANCE) ====================
   - Feature: 4 orientações: landscape, portrait, landscape-flipped, portrait-flipped.
   - Feature: Vídeos tocam até o fim (ignoram tempo configurado).
   - Fix Zumbis: Limpeza forçada do DOM.
   - Offline First: Cache automático e reprodução sem internet.
   - Status: Indicador de Wi-Fi.
   - Perf: getCachedUrl serve URL direta quando online (sem blob na RAM).
   - Perf: Watchdog 90s (TV Box lento não fica reiniciando em loop).
   - Perf: CHECK e PING defasados em 15s (não disparam juntos).
*/

const CONFIG = {
  POLL_INTERVAL: 10000,      // 10s: Intervalo de pareamento
  CHECK_INTERVAL: 60000,     // 1 min: Verifica playlist
  PING_INTERVAL: 30000,      // 30s: Ping online
  PING_DELAY: 15000,         // 15s: Defasa o PING em relação ao CHECK
  WATCHDOG_TIMEOUT: 90000,   // 90s: Reinicia se travar — aumentado para TV Box lento
  CACHE_NAME: 'loopin-v21',
  FADE_TIME: 800             // Tempo da transição visual (ms)
};

// Imagens de Fundo Padrão (Unsplash)
const WEATHER_BG = {
  day: {
    clear: 'https://images.unsplash.com/photo-1622278612015-2f63cb280cf2?q=80&w=1920&fit=crop',
    clouds: 'https://images.unsplash.com/photo-1594156563697-b9290b811341?q=80&w=1920&fit=crop',
    rain: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?q=80&w=1920&fit=crop',
    thunderstorm: 'https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?q=80&w=1920&fit=crop',
    default: 'https://images.unsplash.com/photo-1601297183305-6df142704ea2?q=80&w=1920&fit=crop'
  },
  night: {
    clear: 'https://images.unsplash.com/photo-1532978440754-0610dad4f220?q=80&w=1920&fit=crop',
    clouds: 'https://images.unsplash.com/photo-1502485552307-889d71c4df3e?q=80&w=1920&fit=crop',
    rain: 'https://images.unsplash.com/photo-1503435824048-a799a3a84bf7?q=80&w=1920&fit=crop',
    default: 'https://images.unsplash.com/photo-1472552944129-b035e9ea48c8?q=80&w=1920&fit=crop'
  }
};

const State = {
  deviceId: null,
  isRegistered: false,
  isPlaying: false,
  isOffline: !navigator.onLine,
  playlist: [],
  currentIndex: -1,
  watchdogTimer: null,
  settings: {},
  realtimeSubscription: null,
  orientation: 'landscape'
};

// ==================== 1. BOOTSTRAP ====================
document.addEventListener('DOMContentLoaded', () => {
  setupMouseHider();
  let storedId = localStorage.getItem('loopin_device_id');
  if (!storedId) {
    storedId = `TELA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    localStorage.setItem('loopin_device_id', storedId);
  }
  State.deviceId = storedId;
  console.log(`🆔 Device ID: ${State.deviceId}`);
  checkAndStart();
});

// ==================== 2. INICIALIZAÇÃO ====================
async function checkAndStart() {
  startClock();
  updateConnectionStatus();

  if (State.isOffline) {
    console.warn('⚠️ Offline Mode');
    const cached = localStorage.getItem('loopin_cached_playlist');
    if (cached) {
      State.playlist = JSON.parse(cached);
      startPlayback();
    } else {
      setTimeout(checkAndStart, 5000);
    }
    return;
  }

  try {
    const { data: screen } = await supabaseClient
      .from('screens')
      .select('id')
      .eq('device_id', State.deviceId)
      .maybeSingle();

    if (!screen) {
      document.getElementById('setupScreen').classList.remove('hidden');
      document.getElementById('pairingCode').innerText = State.deviceId;
      document.getElementById('playerContainer').classList.add('hidden');
      setTimeout(checkAndStart, CONFIG.POLL_INTERVAL);
      return;
    }

    State.isRegistered = true;
    document.getElementById('setupScreen').classList.add('hidden');
    startPlayback();

  } catch (err) {
    setTimeout(checkAndStart, CONFIG.POLL_INTERVAL);
  }
}

async function startPlayback() {
  requestWakeLock();

  if (State.isPlaying) return;
  State.isPlaying = true;

  showLoading('Iniciando...');

  try {
    await loadSettings();
    await fetchPlaylist(true);
    setupRealtimeUpdates();

    if (!document.getElementById('loadingScreen').classList.contains('hidden')) {
      if (State.playlist.length > 0) {
        hideLoading();
        playNext();
      } else {
        showLoading('Aguardando conteúdo...');
      }
    }

    setInterval(() => fetchPlaylist(false), CONFIG.CHECK_INTERVAL);
    // PING defasado 15s em relação ao CHECK para não sobrecarregar juntos
    setTimeout(() => setInterval(sendPing, CONFIG.PING_INTERVAL), CONFIG.PING_DELAY);

  } catch (err) {
    console.error('Fatal Error:', err);
    setTimeout(() => window.location.reload(), 10000);
  }
}

// ==================== 3. DOWNLOAD & CACHE ====================
async function downloadAssets(items) {
  if (!items || items.length === 0) return;
  try {
    const cache = await caches.open(CONFIG.CACHE_NAME);
    const urlsToCache = [];

    items.forEach(item => { if (item.url) urlsToCache.push(item.url); });

    const customBg = State.settings.weather_backgrounds || {};
    Object.values(customBg).forEach(url => { if (url) urlsToCache.push(url); });
    Object.values(WEATHER_BG.day).forEach(url => urlsToCache.push(url));
    Object.values(WEATHER_BG.night).forEach(url => urlsToCache.push(url));

    const promises = urlsToCache.map(async (url) => {
      try {
        const match = await cache.match(url);
        if (!match) await cache.add(url);
      } catch (e) { }
    });

    await Promise.allSettled(promises);
    console.log('✅ Cache offline sincronizado');
  } catch (err) {
    console.warn('Erro cache:', err);
  }
}

// ==================== 4. BUSCA DE DADOS ====================
function setupRealtimeUpdates() {
  if (State.realtimeSubscription) return;
  State.realtimeSubscription = supabaseClient
    .channel('player-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_items' }, () => fetchPlaylist(false))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'screens', filter: `device_id=eq.${State.deviceId}` }, () => {
      fetchPlaylist(false);
      loadSettings(); // Reaplicará orientação automaticamente
    })
    .subscribe();
}

async function fetchPlaylist(isFirstLoad) {
  if (State.isOffline) return;

  try {
    const { data: screen } = await supabaseClient
      .from('screens')
      .select('active_playlist_id')
      .eq('device_id', State.deviceId)
      .maybeSingle();

    if (!screen?.active_playlist_id) return;

    const { data: campaigns } = await supabaseClient
      .from('playlist_items')
      .select(`id, campaign_id, duration, display_order, campaigns!campaign_id (id, name, media_url, media_type, duration_seconds)`)
      .eq('playlist_id', screen.active_playlist_id)
      .order('display_order', { ascending: true });

    const { data: widgets } = await supabaseClient
      .from('playlist_items')
      .select(`id, widget_id, duration, display_order, dynamic_contents!widget_id (id, name, content_type, configuration)`)
      .eq('playlist_id', screen.active_playlist_id)
      .order('display_order', { ascending: true });

    const newList = [];

    if (campaigns) {
      campaigns.forEach(item => {
        if (item.campaigns && item.campaigns.media_url) {
          newList.push({
            id: item.campaigns.id,
            name: item.campaigns.name,
            type: 'media',
            renderType: 'media',
            url: item.campaigns.media_url,
            mediaType: item.campaigns.media_type || 'image',
            duration: item.duration || item.campaigns.duration_seconds || 10,
            order: item.display_order
          });
        }
      });
    }

    if (widgets) {
      widgets.forEach(item => {
        if (item.dynamic_contents) {
          const widget = item.dynamic_contents;
          let config = {};
          try { config = typeof widget.configuration === 'string' ? JSON.parse(widget.configuration) : (widget.configuration || {}); } catch (e) { }
          const type = widget.content_type?.toLowerCase() || '';

          if (['ticker', 'text', 'news'].includes(type)) {
            const textContent = config.text || (type === 'news' ? `Notícias: ${config.category || 'Gerais'}` : 'Texto vazio');
            newList.push({
              id: widget.id, name: widget.name, renderType: 'text',
              text: textContent,
              bgColor: config.bg_color || '#000', textColor: config.text_color || '#fff',
              duration: item.duration || 15, order: item.display_order
            });
          }
          else if (['weather', 'clima'].includes(type)) {
            newList.push({
              id: widget.id, name: widget.name, renderType: 'weather',
              city: config.city || 'São Paulo',
              duration: item.duration || 15, order: item.display_order
            });
          }
          else if (type === 'html') {
            newList.push({
              id: widget.id, name: widget.name, renderType: 'html',
              html: config.html || '', duration: item.duration || 15, order: item.display_order
            });
          }
        }
      });
    }

    newList.sort((a, b) => a.order - b.order);

    if (newList.length > 0) {
      const isDifferent = JSON.stringify(newList) !== JSON.stringify(State.playlist);
      if (isDifferent || isFirstLoad) {
        console.log(`📦 Playlist: ${newList.length} itens`);
        State.playlist = newList;
        localStorage.setItem('loopin_cached_playlist', JSON.stringify(newList));
        downloadAssets(newList);

        if (isFirstLoad && !document.getElementById('loadingScreen').classList.contains('hidden')) {
          hideLoading();
          playNext();
        }
      }
    }
  } catch (err) { console.error('Fetch error:', err); }
}

// ==================== 5. REPRODUÇÃO ====================
async function playNext() {
  resetWatchdog();

  if (State.playlist.length === 0) {
    setTimeout(playNext, 3000);
    return;
  }

  State.currentIndex = (State.currentIndex + 1) % State.playlist.length;
  const item = State.playlist[State.currentIndex];

  console.log(`▶️ (${State.currentIndex + 1}/${State.playlist.length}) ${item.name} [${item.renderType}]`);

  const activeSlot = document.querySelector('.media-slot.active');
  const nextSlot = activeSlot.id === 'slot1' ? document.getElementById('slot2') : document.getElementById('slot1');

  nextSlot.innerHTML = '';

  try {
    if (item.renderType === 'media') {
      await renderMedia(item, nextSlot, activeSlot);
    } else if (item.renderType === 'text') {
      renderTicker(item, nextSlot, activeSlot);
    } else if (item.renderType === 'weather') {
      renderWeather(item, nextSlot, activeSlot);
    } else if (item.renderType === 'html') {
      renderHTML(item, nextSlot, activeSlot);
    } else {
      playNext();
    }
  } catch (e) {
    console.error('Erro render:', e);
    playNext();
  }
}

// ==================== 6. RENDERIZADORES ====================

async function renderMedia(item, nextSlot, activeSlot) {
  const src = await getCachedUrl(item.url);

  if (item.mediaType === 'video') {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.loop = false;

    video.onended = () => {
      console.log('🎬 Vídeo finalizado, avançando...');
      playNext();
    };

    video.style.opacity = '0';
    video.oncanplay = () => doTransition(activeSlot, nextSlot, item, video);
    video.onerror = () => { console.error('Erro vídeo'); playNext(); };

    nextSlot.appendChild(video);

  } else {
    const img = document.createElement('img');
    img.src = src;
    img.style.opacity = '0';
    img.onload = () => doTransition(activeSlot, nextSlot, item, null);
    img.onerror = () => playNext();
    nextSlot.appendChild(img);
  }
}

function renderTicker(item, nextSlot, activeSlot) {
  const div = document.createElement('div');
  div.className = 'ticker-slide';
  div.style.background = item.bgColor || '#1A202C';
  div.style.opacity = '0';
  div.innerHTML = `<div class="ticker-content" style="color:${item.textColor || '#fff'}">${item.text}</div>`;
  nextSlot.appendChild(div);
  doTransition(activeSlot, nextSlot, item, null);
}

async function renderWeather(item, nextSlot, activeSlot) {
  const city = item.city || 'São Paulo';

  const wrapper = document.createElement('div');
  wrapper.className = 'weather-slide';
  wrapper.style.opacity = '0';

  wrapper.innerHTML = `
    <div class="weather-overlay"></div>
    <div class="weather-card">
      <p class="weather-subtitle">Previsão do Tempo</p>
      <h1 class="weather-city">${city}</h1>
      <div class="weather-main">
        <img class="weather-icon-large" src="" style="display:none">
        <div class="weather-temp">--°</div>
      </div>
      <p class="weather-description">Atualizando...</p>
      <div class="weather-grid">
        <div class="weather-item">💧 <span class="hum">--%</span></div>
        <div class="weather-item">💨 <span class="wind">-- km/h</span></div>
      </div>
    </div>
  `;

  nextSlot.appendChild(wrapper);
  doTransition(activeSlot, nextSlot, item, null);

  const applyBackground = async (url) => {
    const src = await getCachedUrl(url);
    const isVideo = url.match(/\.(mp4|webm|mov)$/i);
    const oldVideo = wrapper.querySelector('.weather-bg-video');
    if (oldVideo) oldVideo.remove();

    if (isVideo) {
      const video = document.createElement('video');
      video.className = 'weather-bg-video';
      video.src = src;
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      wrapper.insertBefore(video, wrapper.firstChild);
      wrapper.style.backgroundImage = 'none';
    } else {
      wrapper.style.backgroundImage = `url('${src}')`;
    }
  };

  const fillData = (data) => {
    const card = nextSlot.querySelector('.weather-card');
    if (!card || !data.main) return;

    const isNight = data.weather[0].icon.includes('n');
    const id = data.weather[0].id;
    const customBg = State.settings.weather_backgrounds || {};

    let bgUrl = isNight ? WEATHER_BG.night.default : WEATHER_BG.day.clear;

    if (id >= 200 && id < 300) bgUrl = isNight ? (customBg.night_rain || WEATHER_BG.night.thunderstorm) : (customBg.day_storm || WEATHER_BG.day.thunderstorm);
    else if (id >= 300 && id < 600) bgUrl = isNight ? (customBg.night_rain || WEATHER_BG.night.rain) : (customBg.day_rain || WEATHER_BG.day.rain);
    else if (id >= 801) bgUrl = isNight ? (customBg.night_clear || WEATHER_BG.night.clouds) : (customBg.day_clouds || WEATHER_BG.day.clouds);
    else bgUrl = isNight ? (customBg.night_clear || WEATHER_BG.night.clear) : (customBg.day_clear || WEATHER_BG.day.clear);

    applyBackground(bgUrl);

    card.querySelector('.weather-temp').innerText = Math.round(data.main.temp) + '°';
    card.querySelector('.weather-description').innerText = data.weather[0].description;
    card.querySelector('.hum').innerText = data.main.humidity + '%';
    card.querySelector('.wind').innerText = Math.round(data.wind.speed * 3.6) + ' km/h';

    const icon = card.querySelector('.weather-icon-large');
    icon.src = `https://openweathermap.org/img/wn/${data.weather[0].icon}@4x.png`;
    icon.style.display = 'block';
  };

  const cacheKey = 'weather_last_data';
  if (State.settings?.api_weather_key && !State.isOffline) {
    const safeCity = encodeURIComponent(city.trim()) + ',BR';
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${safeCity}&units=metric&lang=pt_br&appid=${State.settings.api_weather_key}`;

    fetch(url).then(r => r.json()).then(data => {
      if (data.main) { localStorage.setItem(cacheKey, JSON.stringify(data)); fillData(data); }
    }).catch(() => { const c = localStorage.getItem(cacheKey); if (c) fillData(JSON.parse(c)); });
  } else {
    const c = localStorage.getItem(cacheKey);
    if (c) fillData(JSON.parse(c));
    else {
      wrapper.querySelector('.weather-description').innerText = "Sem dados offline";
      applyBackground(WEATHER_BG.day.clear);
    }
  }
}

function renderHTML(item, nextSlot, activeSlot) {
  const div = document.createElement('div');
  div.style.width = '100%';
  div.style.height = '100%';
  div.style.opacity = '0';
  div.style.background = '#000';
  div.innerHTML = item.html;
  nextSlot.appendChild(div);
  doTransition(activeSlot, nextSlot, item, null);
}

// ==================== 7. TRANSIÇÃO ====================
function doTransition(curr, next, item, vid) {
  requestAnimationFrame(() => {
    next.classList.add('active');
    curr.classList.remove('active');

    setTimeout(() => { curr.innerHTML = ''; }, CONFIG.FADE_TIME + 200);

    if (vid) {
      vid.style.opacity = 1;
      vid.play().catch(() => playNext());
      console.log(`🎬 Tocando vídeo (aguardando fim)...`);
    } else {
      const el = next.querySelector('.weather-slide, .ticker-slide, img, div');
      if (el) { el.style.transition = 'opacity 0.5s ease-in-out'; el.style.opacity = 1; }
      let duration = (item.duration || 10) * 1000;
      console.log(`⏱️ Próximo slide em ${duration / 1000}s`);
      setTimeout(playNext, duration);
    }
  });
}

// ==================== 8. ORIENTAÇÃO DA TELA (4 MODOS) ====================
/*
  Valores aceitos na coluna `orientation` da tabela `screens`:

  "landscape"         → 🖥️  Horizontal normal        (0°)   cabo/entrada pra baixo
  "landscape-flipped" → 🖥️  Horizontal invertido     (180°) cabo/entrada pra cima
  "portrait"          → 📱  Vertical — cabo pra direita (90°)
  "portrait-flipped"  → 📱  Vertical — cabo pra esquerda (-90°)
*/
function applyOrientation(orientation) {
  const body = document.body;

  // Limpa estilos anteriores primeiro para evitar conflitos
  body.removeAttribute('style');

  switch (orientation) {

    case 'landscape-flipped':
      // TV deitada mas de cabeça pra baixo — só rotaciona 180°
      body.style.transform      = 'rotate(180deg)';
      body.style.transformOrigin = 'center center';
      body.style.width          = '100vw';
      body.style.height         = '100vh';
      body.style.position       = 'fixed';
      body.style.top            = '0';
      body.style.left           = '0';
      body.style.overflow       = 'hidden';
      console.log('🖥️ Landscape Flipped (180°)');
      break;

    case 'portrait':
      // TV em pé — cabo/conector pra direita (roda 90° sentido horário)
      body.style.transform      = 'rotate(90deg)';
      body.style.transformOrigin = 'center center';
      body.style.width          = '100vh';
      body.style.height         = '100vw';
      body.style.position       = 'fixed';
      body.style.top            = '50%';
      body.style.left           = '50%';
      body.style.marginTop      = '-50vw';
      body.style.marginLeft     = '-50vh';
      body.style.overflow       = 'hidden';
      console.log('📱 Portrait (90° — cabo pra direita)');
      break;

    case 'portrait-flipped':
      // TV em pé — cabo/conector pra esquerda (roda -90° sentido anti-horário)
      body.style.transform      = 'rotate(-90deg)';
      body.style.transformOrigin = 'center center';
      body.style.width          = '100vh';
      body.style.height         = '100vw';
      body.style.position       = 'fixed';
      body.style.top            = '50%';
      body.style.left           = '50%';
      body.style.marginTop      = '-50vw';
      body.style.marginLeft     = '-50vh';
      body.style.overflow       = 'hidden';
      console.log('📱 Portrait Flipped (-90° — cabo pra esquerda)');
      break;

    case 'landscape':
    default:
      // Padrão — horizontal normal, sem rotação
      console.log('🖥️ Landscape (normal — 0°)');
      break;
  }

  State.orientation = orientation || 'landscape';
}

// ==================== 9. UTILS ====================
/*
  getCachedUrl — estratégia por estado de conexão:
  - ONLINE:  serve a URL pública diretamente. Não cria blob na RAM.
             O browser faz cache HTTP normalmente. TV Box agradece.
  - OFFLINE: busca no Cache API e converte para blob: URL local.
             Sem internet, é a única forma de exibir o arquivo.
*/
async function getCachedUrl(url) {
  if (!url) return null;

  // Online → URL direta, zero blob na memória
  if (!State.isOffline) return url;

  // Offline → tenta servir do cache local
  try {
    const cache = await caches.open(CONFIG.CACHE_NAME);
    const resp  = await cache.match(url);
    if (resp) return URL.createObjectURL(await resp.blob());
  } catch (err) { /* sem cache, cai na URL original */ }

  return url;
}

async function loadSettings() {
  try {
    // Busca user_id E orientation em uma única query
    const { data: s } = await supabaseClient
      .from('screens')
      .select('user_id, orientation')
      .eq('device_id', State.deviceId)
      .maybeSingle();

    if (s) {
      // Aplica orientação — também é chamado pelo realtime ao mudar no admin
      applyOrientation(s.orientation);

      const { data: set } = await supabaseClient
        .from('settings')
        .select('*')
        .eq('user_id', s.user_id)
        .maybeSingle();

      if (set) {
        State.settings = set;
        if (set.organization_logo_url) {
          const img = document.getElementById('orgLogo');
          if (img) { img.src = set.organization_logo_url; img.classList.remove('hidden'); }
        }
      }
    }
  } catch (e) {
    console.warn('Erro ao carregar settings:', e);
  }
}

function resetWatchdog() {
  if (State.watchdogTimer) clearTimeout(State.watchdogTimer);
  State.watchdogTimer = setTimeout(() => location.reload(), CONFIG.WATCHDOG_TIMEOUT);
}

function startClock() {
  const topRight = document.querySelector('.widget-box.top-right');
  if (topRight && !document.getElementById('wifiStatus')) {
    const wifi = document.createElement('div');
    wifi.id = 'wifiStatus';
    wifi.className = 'wifi-offline';
    wifi.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg><span>OFFLINE</span>`;
    topRight.insertBefore(wifi, topRight.firstChild);
  }
  setInterval(() => {
    const n = new Date();
    document.getElementById('clockTime').innerText = n.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('clockDate').innerText = n.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  }, 1000);
}

function updateConnectionStatus() {
  const el = document.getElementById('wifiStatus');
  if (!el) return;
  if (State.isOffline) el.classList.add('visible');
  else el.classList.remove('visible');
}

function showLoading(t) {
  document.getElementById('loadingText').innerText = t;
  document.getElementById('loadingScreen').classList.remove('hidden');
  document.getElementById('playerContainer').classList.add('hidden');
}

function hideLoading() {
  document.getElementById('loadingScreen').classList.add('hidden');
  document.getElementById('playerContainer').classList.remove('hidden');
}

function setupMouseHider() {
  let t;
  window.addEventListener('mousemove', () => {
    document.body.classList.add('mouse-visible');
    clearTimeout(t);
    t = setTimeout(() => document.body.classList.remove('mouse-visible'), 2000);
  });
}

async function sendPing() {
  if (State.isRegistered && !State.isOffline) {
    supabaseClient.from('screens').update({ last_ping: new Date(), status: 'online' }).eq('device_id', State.deviceId).then();
  }
}

window.addEventListener('online', () => { State.isOffline = false; updateConnectionStatus(); if (State.isRegistered) fetchPlaylist(false); });
window.addEventListener('offline', () => { State.isOffline = true; updateConnectionStatus(); });

// ==================== MANTER TELA LIGADA ====================
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      let wakeLock = await navigator.wakeLock.request('screen');
      console.log('💡 Wake Lock ativo');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ Wake Lock não suportado:', err);
  }
}

console.log('✅ Player.js V6.5 (Performance) Loaded');
