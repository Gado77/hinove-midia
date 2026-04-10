package com.loopin.loopintv

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.bumptech.glide.Glide
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    // ==================== ESTADO ====================

    private var deviceId: String = ""
    private lateinit var supabase: SupabaseManager
    private var settings = ScreenSettings()

    private var playlist = listOf<PlaylistItem>()
    private var currentIndex = -1
    private var isPlaying = false
    private var isOffline = false

    private lateinit var slotA: FrameLayout
    private lateinit var slotB: FrameLayout
    private var activeSlot: FrameLayout? = null

    private var exoPlayer: ExoPlayer? = null
    private var exoPlayerView: PlayerView? = null
    private var currentExoListener: Player.Listener? = null

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var screenshotPendingIntent: android.app.PendingIntent? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val bgExecutor = Executors.newSingleThreadExecutor()

    private var watchdogRunnable: Runnable? = null
    private var tapCount = 0
    private var lastTapTime = 0L

    // ==================== LIFECYCLE ====================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        // Auto restart se crashar
        Thread.setDefaultUncaughtExceptionHandler { _, _ ->
            val intent = packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            Runtime.getRuntime().exit(0)
        }

        slotA = findViewById(R.id.slotA)
        slotB = findViewById(R.id.slotB)

        deviceId = loadOrCreateDeviceId()
        supabase = SupabaseManager(this)

        setupClock()
        startKioskMode()
        startService(Intent(this, WatchdogService::class.java))

        findViewById<Button>(R.id.btnRefreshCode).setOnClickListener {
            val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            val newSuffix = (1..6).map { chars.random() }.joinToString("")
            val newId = "TELA-$newSuffix"
            getSharedPreferences("loopin", MODE_PRIVATE)
                .edit().putString("device_id", newId).apply()
            deviceId = newId
            findViewById<TextView>(R.id.pairingCodeText).text = deviceId
            showLoading("Verificando vinculação...")
            bgExecutor.execute { syncAndPlay() }
        }

        if (playlist.isEmpty()) showLoading("Sincronizando...")
        bgExecutor.execute { syncAndPlay() }
    }

    override fun onResume() {
        super.onResume()
        enableFullscreen()
        exoPlayer?.play()
    }

    override fun onPause() {
        super.onPause()
        exoPlayer?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        mainHandler.removeCallbacksAndMessages(null)
        bgExecutor.shutdown()
        exoPlayer?.release()
        exoPlayer = null
    }

    // ==================== BLOQUEIO DE BOTÕES ====================

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_MUTE,
            KeyEvent.KEYCODE_HOME,
            KeyEvent.KEYCODE_MENU,
            KeyEvent.KEYCODE_APP_SWITCH -> true
            else -> super.onKeyDown(keyCode, event)
        }
    }

    // ==================== DEVICE ID ====================

    private fun loadOrCreateDeviceId(): String {
        val prefs = getSharedPreferences("loopin", MODE_PRIVATE)
        var id = prefs.getString("device_id", null)

        if (id == null) {
            try {
                val file = java.io.File(filesDir, "device_id.txt")
                if (file.exists()) id = file.readText().trim()
            } catch (e: Exception) {}
        }

        if (id == null) id = generateDeviceId()

        prefs.edit().putString("device_id", id).apply()
        try { java.io.File(filesDir, "device_id.txt").writeText(id) } catch (e: Exception) {}

        return id
    }

    private fun generateDeviceId(): String {
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        val androidIdValido = androidId != null && androidId != "0000000000000000" && androidId.length >= 6
        if (androidIdValido) return "TELA-" + androidId.takeLast(6).uppercase()

        try {
            val wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as android.net.wifi.WifiManager
            val mac = wifiManager.connectionInfo.macAddress
            if (mac != null && mac != "02:00:00:00:00:00" && mac != "00:00:00:00:00:00") {
                return "TELA-" + mac.replace(":", "").takeLast(6).uppercase()
            }
        } catch (e: Exception) {}

        try {
            val serial = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Build.getSerial()
            } else {
                @Suppress("DEPRECATION") Build.SERIAL
            }
            if (serial != null && serial != "unknown" && serial.length >= 6) {
                return "TELA-" + serial.takeLast(6).uppercase()
            }
        } catch (e: Exception) {}

        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return "TELA-" + (1..6).map { chars.random() }.joinToString("")
    }

    // ==================== CICLO PRINCIPAL ====================

    private fun syncAndPlay() {
        android.util.Log.d("Sync", "=== syncAndPlay START ===")
        
        if (!isInternetAvailable()) {
            android.util.Log.d("Sync", "Internet não disponível — aguardando 10s")
            logToPlayer("sync:no_internet", "Aguardando internet...")
            mainHandler.postDelayed({ bgExecutor.execute { syncAndPlay() } }, 10_000)
            return
        }
        
        android.util.Log.d("Sync", "Internet OK")

        val registered = supabase.isScreenRegistered(deviceId)

        if (!registered) {
            android.util.Log.d("Sync", "Screen não registrada")
            logToPlayer("sync:not_registered", "Aguardando vinculação...")
            mainHandler.post {
                showSetupScreen()
                mainHandler.postDelayed({ bgExecutor.execute { syncAndPlay() } }, 10_000)
            }
            return
        }
        
        android.util.Log.d("Sync", "Screen registrada: $deviceId")

        val temConteudo = playlist.isNotEmpty()
        if (!temConteudo) mainHandler.post { showLoading("Sincronizando...") }

        settings = supabase.loadSettings(deviceId)
        android.util.Log.d("LoopinDEBUG", "ScreenSettings: screenUuid=" + settings.screenUuid + ", userId=" + settings.userId)
        logToPlayer("sync:settings_loaded", "UUID: ${settings.screenUuid}")
        
        if (settings.screenUuid.isNotEmpty()) {
            bgExecutor.execute {
                supabase.sendLog(settings.screenUuid, "app_start", "Player iniciado: $deviceId")
            }
        }

        mainHandler.post {
            applyOrientation(settings.orientation)
            applyLogo(settings.orgLogoUrl)
        }

        val items = supabase.fetchPlaylist(deviceId)
        android.util.Log.d("Sync", "Playlist fetched: ${items.size} items")

        if (items.isEmpty()) {
            android.util.Log.d("Sync", "Playlist vazia")
            logToPlayer("sync:playlist_empty", "Aguardando playlist...")
            mainHandler.post { showLoading("Aguardando playlist...") }
            mainHandler.postDelayed({ bgExecutor.execute { syncAndPlay() } }, 15_000)
            return
        }
        
        logToPlayer("sync:playlist_fetched", "${items.size} itens")

        val withinBusinessHours = isWithinBusinessHours(settings.businessHours)
        android.util.Log.d("Sync", "Business hours check: $withinBusinessHours")
        
        if (!withinBusinessHours && settings.businessHours.isNotEmpty()) {
            logToPlayer("sync:outside_hours", "Fora do horário de funcionamento")
            mainHandler.post { showOutsideBusinessHours() }
            mainHandler.postDelayed({
                val newWithinHours = isWithinBusinessHours(settings.businessHours)
                if (newWithinHours) {
                    mainHandler.post {
                        hideOutsideBusinessHours()
                        if (!isPlaying && playlist.isNotEmpty()) {
                            isPlaying = true
                            playNext()
                        }
                    }
                }
            }, 60_000)
            return
        }
        
        logToPlayer("sync:business_hours_ok", "Dentro do horário")

        // Não baixa mais todas as mídias upfront - o renderMedia baixa sob demanda
        // Isso evita OOM em TV Boxes com RAM limitada
        
        playlist = items
        currentIndex = -1

        mainHandler.post {
            hideSetupScreen()
            hideLoading()
            if (!isPlaying) {
                isPlaying = true
                playNext()
            }
        }
        
        logToPlayer("sync:playback_started", "Iniciando reprodução")

        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                bgExecutor.execute {
                    try {
                        val newItems = supabase.fetchPlaylist(deviceId)
                        if (newItems.isNotEmpty() && newItems != playlist) {
                            val activeUrls = newItems.mapNotNull { it.url }
                            supabase.cleanupOldMedia(activeUrls)
                            playlist = newItems
                            logToPlayer("sync:playlist_updated", "${newItems.size} itens")
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("Sync", "Erro ao atualizar playlist: ${e.message}")
                    }
                }
                mainHandler.postDelayed(this, 60_000)
            }
        }, 60_000)

        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                val currentItem = if (playlist.isNotEmpty() && currentIndex >= 0) playlist[currentIndex].name else ""
                val cacheUsed = supabase.getCacheUsedMb()
                bgExecutor.execute { supabase.sendPing(deviceId, currentItem, cacheUsed, playlist.size) }
                mainHandler.postDelayed(this, 30_000)
            }
        }, 15_000)

        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                if (outsideHoursView != null) {
                    val newSettings = supabase.loadSettings(deviceId)
                    settings = newSettings
                    val withinHours = isWithinBusinessHours(settings.businessHours)
                    if (withinHours) {
                        mainHandler.post {
                            hideOutsideBusinessHours()
                            if (!isPlaying && playlist.isNotEmpty()) {
                                isPlaying = true
                                playNext()
                            }
                        }
                    }
                }
                mainHandler.postDelayed(this, 60_000)
            }
        }, 60_000)

        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                checkAndExecuteCommands()
                mainHandler.postDelayed(this, 10_000)
            }
        }, 5_000)
    }

    private fun checkAndExecuteCommands() {
        if (settings.screenUuid.isEmpty()) return

        bgExecutor.execute {
            val command = supabase.fetchPendingCommand(settings.screenUuid)
            if (command != null) {
                android.util.Log.d("MainActivity", "Comando recebido: ${command.command}")
                
                // Log do recebimento do comando
                supabase.sendLog(settings.screenUuid, "command_received", "Comando: ${command.command}", JSONObject().apply {
                    put("command_id", command.id)
                    put("payload", command.payload)
                })

                when (command.command) {
                    "refresh" -> {
                        mainHandler.post { doFullReload() }
                    }
                    "restart" -> {
                        mainHandler.post { doRestart() }
                    }
                    "pause" -> {
                        mainHandler.post {
                            isPlaying = false
                            exoPlayer?.pause()
                            supabase.sendLog(settings.screenUuid, "player_paused", "Reprodução pausada via comando")
                        }
                    }
                    "resume" -> {
                        mainHandler.post {
                            isPlaying = true
                            exoPlayer?.play()
                            if (currentIndex == -1) playNext()
                            supabase.sendLog(settings.screenUuid, "player_resumed", "Reprodução retomada via comando")
                        }
                    }
                    "update_orientation" -> {
                        mainHandler.post {
                            val newOrientation = command.payload.ifEmpty { "landscape" }
                            applyOrientation(newOrientation)
                            supabase.sendLog(settings.screenUuid, "orientation_changed", "Nova orientação: $newOrientation")
                        }
                    }
                    "maintenance_mode" -> {
                        mainHandler.post {
                            val active = command.payload == "true" || command.payload == "1"
                            if (active) showMaintenanceScreen() else hideLoading()
                            supabase.sendLog(settings.screenUuid, "maintenance_mode", "Modo manutenção: $active")
                        }
                    }
                    "screenshot" -> {
                        bgExecutor.execute { takeRemoteScreenshot() }
                    }
                }
                supabase.markCommandExecuted(command.id)
            }
        }
    }

    private fun takeRemoteScreenshot() {
        mainHandler.post {
            try {
                val bitmap = tryCaptureFromTextureView()
                if (bitmap != null && !bitmap.isRecycled) {
                    uploadScreenshotBitmap(bitmap)
                    return@post
                }
                android.util.Log.d("Screenshot", "TextureView capture failed, trying MediaProjection")
                startMediaProjectionCapture()
            } catch (e: Exception) {
                android.util.Log.e("Screenshot", "Error: ${e.message}")
                tryFallbackCapture()
            }
        }
    }

    private fun tryCaptureFromTextureView(): Bitmap? {
        try {
            val textureView = findTextureView()
            if (textureView != null && textureView.bitmap != null) {
                val bitmap = textureView.bitmap
                android.util.Log.d("Screenshot", "Captured via TextureView: ${bitmap.width}x${bitmap.height}")
                return bitmap
            }
        } catch (e: Exception) {
            android.util.Log.e("Screenshot", "TextureView capture error: ${e.message}")
        }
        return null
    }

    private fun findTextureView(): TextureView? {
        return findViewById<ViewGroup>(android.R.id.content)?.let { root ->
            findTextureViewRecursive(root)
        }
    }

    private fun findTextureViewRecursive(viewGroup: ViewGroup): TextureView? {
        for (i in 0 until viewGroup.childCount) {
            val child = viewGroup.getChildAt(i)
            if (child is TextureView) {
                return child
            }
            if (child is ViewGroup) {
                val found = findTextureViewRecursive(child)
                if (found != null) return found
            }
        }
        return null
    }

    private fun startMediaProjectionCapture() {
        try {
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val intent = projectionManager.createScreenCaptureIntent()
            val requestCode = 999
            startActivityForResult(intent, requestCode)
        } catch (e: Exception) {
            android.util.Log.e("Screenshot", "MediaProjection error: ${e.message}")
            tryFallbackCapture()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 999 && resultCode == RESULT_OK && data != null) {
            captureWithMediaProjection(data)
        } else {
            android.util.Log.d("Screenshot", "MediaProjection permission denied")
            tryFallbackCapture()
        }
    }

    private fun captureWithMediaProjection(data: Intent) {
        try {
            val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(android.app.Activity.RESULT_OK, data)

            val width = window.decorView.width
            val height = window.decorView.height
            val density = resources.displayMetrics.densityDpi

            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "Screenshot",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface, null, null
            )

            mainHandler.postDelayed({
                try {
                    val image = imageReader?.acquireLatestImage()
                    if (image != null) {
                        val planes = image.planes
                        val buffer = planes[0].buffer
                        val pixelStride = planes[0].pixelStride
                        val rowStride = planes[0].rowStride
                        val rowPadding = rowStride - pixelStride * width

                        val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
                        bitmap.copyPixelsFromBuffer(buffer)
                        val croppedBitmap = Bitmap.createBitmap(bitmap, 0, 0, width, height)
                        bitmap.recycle()
                        image.close()

                        cleanupMediaProjection()

                        if (croppedBitmap != null && !croppedBitmap.isRecycled) {
                            android.util.Log.d("Screenshot", "Captured via MediaProjection: ${croppedBitmap.width}x${croppedBitmap.height}")
                            uploadScreenshotBitmap(croppedBitmap)
                        }
                    } else {
                        android.util.Log.e("Screenshot", "ImageReader returned null")
                        tryFallbackCapture()
                    }
                } catch (e: Exception) {
                    android.util.Log.e("Screenshot", "MediaProjection capture error: ${e.message}")
                    tryFallbackCapture()
                }
            }, 500)
        } catch (e: Exception) {
            android.util.Log.e("Screenshot", "MediaProjection setup error: ${e.message}")
            tryFallbackCapture()
        }
    }

    private fun cleanupMediaProjection() {
        try {
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null
            mediaProjection?.stop()
            mediaProjection = null
        } catch (e: Exception) {
            android.util.Log.e("Screenshot", "Cleanup error: ${e.message}")
        }
    }

    private fun tryFallbackCapture() {
        mainHandler.post {
            try {
                val rootView = findViewById<View>(android.R.id.content).rootView
                val bitmap = Bitmap.createBitmap(rootView.width, rootView.height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                rootView.draw(canvas)

                android.util.Log.d("Screenshot", "Captured via fallback: ${bitmap.width}x${bitmap.height}")
                uploadScreenshotBitmap(bitmap)
            } catch (e: Exception) {
                android.util.Log.e("Screenshot", "Fallback capture error: ${e.message}")
                supabase.sendLog(settings.screenUuid, "screenshot_error", "Erro fallback: ${e.message}")
            }
        }
    }

    private fun uploadScreenshotBitmap(bitmap: Bitmap) {
        val timestamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date())
        val fileName = "screenshot_${deviceId}_$timestamp.png"

        val tempFile = java.io.File(cacheDir, fileName)
        try {
            val fos = java.io.FileOutputStream(tempFile)
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, fos)
            fos.close()

            bgExecutor.execute {
                val (uploadedUrl, errorDetail) = supabase.uploadScreenshot(settings.screenUuid, tempFile)
                if (uploadedUrl != null) {
                    supabase.sendLog(settings.screenUuid, "screenshot_taken", "Screenshot uploaded: $uploadedUrl")
                    android.util.Log.d("Screenshot", "Upload OK: $uploadedUrl")
                } else {
                    supabase.sendLog(settings.screenUuid, "screenshot_failed", "Falha ao fazer upload: $errorDetail")
                    android.util.Log.e("Screenshot", "Upload failed: $errorDetail")
                }
                if (!tempFile.isDirectory) tempFile.delete()
            }
        } catch (e: Exception) {
            android.util.Log.e("Screenshot", "File write error: ${e.message}")
            supabase.sendLog(settings.screenUuid, "screenshot_error", "Erro ao salvar: ${e.message}")
        } finally {
            if (!bitmap.isRecycled) bitmap.recycle()
        }
    }

    private fun showMaintenanceScreen() {
        showLoading("SISTEMA EM MANUTENÇÃO")
        findViewById<TextView>(R.id.loadingText).apply {
            setTextColor(Color.YELLOW)
            textSize = 24f
        }
    }

    private fun doFullReload() {
        isPlaying = false
        currentIndex = -1
        playlist = listOf()
        activeSlot?.removeAllViews()
        activeSlot = null
        exoPlayer?.release()
        exoPlayer = null
        mainHandler.removeCallbacksAndMessages(null)
        setupClock()
        showLoading("Recarregando...")
        bgExecutor.execute { syncAndPlay() }
    }

    private fun doRestart() {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        intent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        finish()
    }

    private fun isInternetAvailable(): Boolean {
        return try {
            val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
                caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } else {
                @Suppress("DEPRECATION")
                val netInfo = cm.activeNetworkInfo
                @Suppress("DEPRECATION")
                netInfo != null && netInfo.isConnected
            }
        } catch (e: Exception) { true }
    }

    private fun logToPlayer(eventType: String, message: String) {
        if (settings.screenUuid.isNotEmpty()) {
            bgExecutor.execute {
                try {
                    supabase.sendLog(settings.screenUuid, eventType, message)
                } catch (e: Exception) {
                    android.util.Log.w("LogPlayer", "Erro ao enviar log: ${e.message}")
                }
            }
        }
    }

    // ==================== REPRODUÇÃO ====================

    private fun playNext() {
        resetWatchdog()

        if (playlist.isEmpty()) {
            mainHandler.postDelayed({ playNext() }, 3_000)
            return
        }

        currentIndex = (currentIndex + 1) % playlist.size
        val item = playlist[currentIndex]

        // ==================== LOG DE REPRODUÇÃO ====================
        // Registra no Supabase cada vez que uma campanha começa a tocar
        // Usado para gerar relatórios de exibição para os clientes
        if (item.renderType == "media" && !item.campaignId.isNullOrEmpty()
            && settings.screenUuid.isNotEmpty() && settings.userId.isNotEmpty()) {
            bgExecutor.execute {
                supabase.logPlayback(
                    screenUuid      = settings.screenUuid,
                    userId          = settings.userId,
                    campaignId      = item.campaignId,
                    durationSeconds = item.duration
                )
            }
        }

        val nextSlot = if (activeSlot == slotA) slotB else slotA

        mainHandler.post {
            when (item.renderType) {
                "media"   -> renderMedia(item, nextSlot)
                "text"    -> renderTicker(item, nextSlot)
                "weather" -> renderWeather(item, nextSlot)
                "html"    -> renderHtml(item, nextSlot)
                else      -> playNext()
            }
        }
    }

    // ==================== RENDERIZADOR: MÍDIA ====================

    private fun renderMedia(item: PlaylistItem, nextSlot: FrameLayout) {
        bgExecutor.execute {
            try {
                val url = item.url ?: run { mainHandler.post { playNext() }; return@execute }
                
                val fileName = url.substringAfterLast("/").substringBefore("?")
                    .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val file = java.io.File(this.filesDir, fileName)
                
                var mediaPath: String? = null
                
                if (file.exists() && file.length() > 0) {
                    android.util.Log.d("Media", "Usando cache: $fileName")
                    logToPlayer("media:cache_hit", fileName)
                    mediaPath = file.absolutePath
                } else if (isInternetAvailable()) {
                    android.util.Log.d("Media", "Baixando: $fileName")
                    logToPlayer("media:downloading", fileName)
                    mediaPath = supabase.downloadMedia(url)
                    if (mediaPath == null) {
                        android.util.Log.e("Media", "Falha ao baixar: $fileName")
                        logToPlayer("media:download_failed", fileName)
                        mainHandler.postDelayed({ playNext() }, 1000)
                        return@execute
                    }
                } else {
                    android.util.Log.e("Media", "Offline e sem cache: $fileName")
                    logToPlayer("media:offline_no_cache", fileName)
                    mainHandler.postDelayed({ playNext() }, 1000)
                    return@execute
                }

                logToPlayer("media:playing", item.name)

                mainHandler.post {
                    try {
                        nextSlot.removeAllViews()
                        if (item.mediaType == "video") renderVideo(mediaPath, nextSlot)
                        else renderImage(mediaPath, item, nextSlot)
                    } catch (e: Exception) {
                        android.util.Log.e("Media", "Erro render UI: ${e.message}")
                        logToPlayer("media:error", e.message ?: "erro desconhecido UI")
                        mainHandler.postDelayed({ playNext() }, 1000)
                    }
                }
                
            } catch (e: Exception) {
                android.util.Log.e("Media", "Erro renderMedia: ${e.message}")
                logToPlayer("media:error", e.message ?: "erro desconhecido background")
                mainHandler.postDelayed({ playNext() }, 1000)
            }
        }
    }

    private fun renderVideo(path: String, nextSlot: FrameLayout) {
        try {
            if (exoPlayer == null) exoPlayer = ExoPlayer.Builder(this).build()

            val playerView = layoutInflater.inflate(R.layout.player_view, nextSlot, false) as PlayerView
            playerView.layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            exoPlayerView = playerView
            nextSlot.addView(playerView)
            playerView.player = exoPlayer

            exoPlayer?.apply {
                currentExoListener?.let { removeListener(it) }
                val listener = object : Player.Listener {
                    override fun onPlaybackStateChanged(state: Int) {
                        when (state) {
                            Player.STATE_READY -> doTransition(nextSlot)
                            Player.STATE_ENDED -> playNext()
                            else -> {}
                        }
                    }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        android.util.Log.e("MainActivity", "Erro vídeo: ${error.message}")
                        playNext()
                    }
                }
                currentExoListener = listener
                addListener(listener)
                stop()
                volume = if (settings.isMuted) 0f else 1f
                setMediaItem(MediaItem.fromUri(path))
                prepare()
                playWhenReady = true
            }
        } catch (e: Exception) {
            android.util.Log.e("RenderVideo", "Erro: ${e.message}")
            playNext()
        }
    }

    private fun renderImage(path: String, item: PlaylistItem, nextSlot: FrameLayout) {
        try {
            val imageView = ImageView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                scaleType = ImageView.ScaleType.CENTER_CROP
            }
            nextSlot.addView(imageView)

            Glide.with(this).load(path)
                .into(object : com.bumptech.glide.request.target.CustomTarget<android.graphics.drawable.Drawable>() {
                    override fun onResourceReady(
                        resource: android.graphics.drawable.Drawable,
                        transition: com.bumptech.glide.request.transition.Transition<in android.graphics.drawable.Drawable>?
                    ) {
                        imageView.setImageDrawable(resource)
                        doTransition(nextSlot)
                        mainHandler.postDelayed({ playNext() }, (item.duration * 1000).toLong())
                    }
                    override fun onLoadFailed(errorDrawable: android.graphics.drawable.Drawable?) { playNext() }
                    override fun onLoadCleared(placeholder: android.graphics.drawable.Drawable?) {}
                })
        } catch (e: Exception) {
            android.util.Log.e("RenderImage", "Erro: ${e.message}")
            playNext()
        }
    }

    // ==================== RENDERIZADOR: TEXTO/TICKER ====================

    private fun renderTicker(item: PlaylistItem, nextSlot: FrameLayout) {
        try {
            nextSlot.removeAllViews()

            val bgColor = try { Color.parseColor(item.bgColor ?: "#1A202C") }
            catch (e: Exception) { Color.parseColor("#1A202C") }

            val textColor = try { Color.parseColor(item.textColor ?: "#FFFFFF") }
            catch (e: Exception) { Color.WHITE }

            val container = FrameLayout(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(bgColor)
            }

            val textView = TextView(this).apply {
                text = item.text ?: ""
                setTextColor(textColor)
                textSize = 32f
                setTypeface(null, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                val pad = (resources.displayMetrics.widthPixels * 0.05f).toInt()
                setPadding(pad, pad, pad, pad)
                setShadowLayer(10f, 2f, 2f, Color.parseColor("#88000000"))
            }

            container.addView(textView)
            nextSlot.addView(container)
            doTransition(nextSlot)
            mainHandler.postDelayed({ playNext() }, (item.duration * 1000).toLong())
        } catch (e: Exception) {
            android.util.Log.e("RenderTicker", "Erro: ${e.message}")
            playNext()
        }
    }

    // ==================== RENDERIZADOR: CLIMA ====================

    @SuppressLint("SetTextI18n")
    private fun renderWeather(item: PlaylistItem, nextSlot: FrameLayout) {
        try {
            nextSlot.removeAllViews()
            var weatherBgPlayer: ExoPlayer? = null

            val rootFrame = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        val bgVideoView = layoutInflater.inflate(R.layout.player_view, rootFrame, false) as PlayerView
        bgVideoView.resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        rootFrame.addView(bgVideoView)

        fun playWeatherVideo(assetFileName: String) {
            weatherBgPlayer?.release()
            weatherBgPlayer = ExoPlayer.Builder(this).build().also { vp ->
                bgVideoView.player = vp
                val uri = android.net.Uri.parse("file:///android_asset/$assetFileName")
                vp.setMediaItem(MediaItem.fromUri(uri))
                vp.repeatMode = ExoPlayer.REPEAT_MODE_ALL
                vp.volume = 0f
                vp.prepare()
                vp.play()
            }
        }

        playWeatherVideo("weather/ceu_limpo.mp4")

        val overlay = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#55000000"))
        }
        rootFrame.addView(overlay)

        val cardWrapper = FrameLayout(this).apply {
            val params = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            params.setMargins(60, 60, 60, 60)
            layoutParams = params
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 60f
                setColor(Color.parseColor("#20FFFFFF"))
                setStroke(1, Color.parseColor("#30FFFFFF"))
            }
            elevation = 20f
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
            )
            setPadding(120, 72, 120, 72)
        }

        val tvSubtitle = TextView(this).apply {
            text = "PREVISÃO DO TEMPO"
            setTextColor(Color.parseColor("#CCFFFFFF"))
            textSize = 11f
            letterSpacing = 0.25f
            gravity = Gravity.CENTER
            setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }
        val tvCity = TextView(this).apply {
            text = (item.city ?: "São Paulo").uppercase()
            setTextColor(Color.WHITE)
            textSize = 30f
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
            setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }
        val tvTemp = TextView(this).apply {
            text = "--°"
            setTextColor(Color.WHITE)
            textSize = 80f
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 0)
            setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }
        val tvDesc = TextView(this).apply {
            text = "Atualizando..."
            setTextColor(Color.parseColor("#DDFFFFFF"))
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 16)
            setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }
        val detailsWrapper = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                cornerRadius = 50f
                setColor(Color.parseColor("#30000000"))
                setStroke(1, Color.parseColor("#20FFFFFF"))
            }
            setPadding(48, 16, 48, 16)
        }
        val tvDetails = TextView(this).apply {
            text = "💧 --   💨 --"
            setTextColor(Color.parseColor("#EEFFFFFF"))
            textSize = 14f
            gravity = Gravity.CENTER
            setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)
        }

        detailsWrapper.addView(tvDetails)
        card.addView(tvSubtitle)
        card.addView(tvCity)
        card.addView(tvTemp)
        card.addView(tvDesc)
        card.addView(detailsWrapper)
        cardWrapper.addView(card)
        rootFrame.addView(cardWrapper)
        nextSlot.addView(rootFrame)

        doTransition(nextSlot)

        mainHandler.postDelayed({
            weatherBgPlayer?.release()
            weatherBgPlayer = null
            playNext()
        }, (item.duration * 1000).toLong())

        if (!settings.weatherApiKey.isNullOrEmpty()) {
            bgExecutor.execute {
                fetchWeatherData(item.city ?: "São Paulo", settings.weatherApiKey!!) { data ->
                    mainHandler.post {
                        tvTemp.text = "${data.temp}°"
                        tvDesc.text = data.description
                        tvDetails.text = "💧 ${data.humidity}%   💨 ${data.windKmh} km/h"
                        playWeatherVideo(getWeatherBgAsset(data.weatherId, data.isNight))
                    }
                }
            }
        }
    } catch (e: Exception) {
        android.util.Log.e("RenderWeather", "Erro: ${e.message}")
        playNext()
    }
}

    private data class WeatherData(
        val temp: Int, val description: String, val humidity: Int,
        val windKmh: Int, val weatherId: Int, val isNight: Boolean
    )

    private fun getCachedWeather(city: String): WeatherData? {
        return try {
            val prefs = getSharedPreferences("loopin_weather", MODE_PRIVATE)
            val cacheKey = "weather_${city.trim().lowercase()}"
            val age = System.currentTimeMillis() - prefs.getLong("${cacheKey}_time", 0)
            if (age > 900_000) return null
            val temp = prefs.getInt("${cacheKey}_temp", Int.MIN_VALUE)
            if (temp == Int.MIN_VALUE) return null
            WeatherData(
                temp        = temp,
                description = prefs.getString("${cacheKey}_desc", "")!!,
                humidity    = prefs.getInt("${cacheKey}_hum", 0),
                windKmh     = prefs.getInt("${cacheKey}_wind", 0),
                weatherId   = prefs.getInt("${cacheKey}_id", 800),
                isNight     = prefs.getBoolean("${cacheKey}_night", false)
            )
        } catch (e: Exception) { null }
    }

    private fun saveWeatherCache(city: String, data: WeatherData) {
        try {
            val prefs = getSharedPreferences("loopin_weather", MODE_PRIVATE)
            val cacheKey = "weather_${city.trim().lowercase()}"
            prefs.edit().apply {
                putLong("${cacheKey}_time", System.currentTimeMillis())
                putInt("${cacheKey}_temp", data.temp)
                putString("${cacheKey}_desc", data.description)
                putInt("${cacheKey}_hum", data.humidity)
                putInt("${cacheKey}_wind", data.windKmh)
                putInt("${cacheKey}_id", data.weatherId)
                putBoolean("${cacheKey}_night", data.isNight)
                apply()
            }
        } catch (e: Exception) {}
    }

    private fun fetchWeatherData(city: String, apiKey: String, callback: (WeatherData) -> Unit) {
        val cached = getCachedWeather(city)
        if (cached != null) {
            callback(cached)
            bgExecutor.execute { fetchFromNetwork(city, apiKey) { saveWeatherCache(city, it) } }
            return
        }
        bgExecutor.execute { fetchFromNetwork(city, apiKey) { saveWeatherCache(city, it); callback(it) } }
    }

    private fun fetchFromNetwork(city: String, apiKey: String, callback: (WeatherData) -> Unit) {
        try {
            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()

            val cleanCity = city.trim()
                .replace(Regex(",\\s*BR$", RegexOption.IGNORE_CASE), "")
                .replace(Regex(",\\s*[A-Z]{2}$"), "").trim()

            val safeCity = java.net.URLEncoder.encode(cleanCity, "UTF-8")
            val geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=$safeCity&count=1&language=pt&format=json&countryCode=BR"
            val geoBody = client.newCall(Request.Builder().url(geoUrl).build()).execute().body?.string() ?: ""
            val results = JSONObject(geoBody).optJSONArray("results")

            if (results != null && results.length() > 0) {
                val location = results.getJSONObject(0)
                fetchOpenMeteo(client, location.getDouble("latitude"), location.getDouble("longitude"), callback)
            } else if (apiKey.isNotEmpty()) {
                fetchOpenWeatherMap(client, cleanCity, apiKey, callback)
            }
        } catch (e: Exception) {
            android.util.Log.e("Weather", "fetchFromNetwork erro: ${e.message}")
        }
    }

    private fun fetchOpenMeteo(client: OkHttpClient, lat: Double, lon: Double, callback: (WeatherData) -> Unit) {
        try {
            val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
                    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
                    "&wind_speed_unit=kmh&timezone=America%2FSao_Paulo"
            val body = client.newCall(Request.Builder().url(url).build()).execute().body?.string() ?: return
            val json = JSONObject(body)
            if (!json.has("current")) return
            val current = json.getJSONObject("current")
            val wmoCode = current.getInt("weather_code")
            callback(WeatherData(
                temp        = current.getDouble("temperature_2m").toInt(),
                description = wmoCodeToDescription(wmoCode),
                humidity    = current.getInt("relative_humidity_2m"),
                windKmh     = current.getDouble("wind_speed_10m").toInt(),
                weatherId   = wmoCodeToWeatherId(wmoCode),
                isNight     = current.getInt("is_day") != 1
            ))
        } catch (e: Exception) { android.util.Log.e("Weather", "Open-Meteo erro: ${e.message}") }
    }

    private fun fetchOpenWeatherMap(client: OkHttpClient, city: String, apiKey: String, callback: (WeatherData) -> Unit) {
        try {
            val safeCity = java.net.URLEncoder.encode("$city,BR", "UTF-8")
            val url = "https://api.openweathermap.org/data/2.5/weather?q=$safeCity&units=metric&lang=pt_br&appid=$apiKey"
            val body = client.newCall(Request.Builder().url(url).build()).execute().body?.string() ?: return
            val json = JSONObject(body)
            if (!json.has("main")) return
            val main = json.getJSONObject("main")
            val weather = json.getJSONArray("weather").getJSONObject(0)
            val wind = json.getJSONObject("wind")
            callback(WeatherData(
                temp        = main.getDouble("temp").toInt(),
                description = weather.getString("description").replaceFirstChar { it.uppercase() },
                humidity    = main.getInt("humidity"),
                windKmh     = (wind.getDouble("speed") * 3.6).toInt(),
                weatherId   = weather.getInt("id"),
                isNight     = weather.getString("icon").endsWith("n")
            ))
        } catch (e: Exception) { android.util.Log.e("Weather", "OpenWeatherMap erro: ${e.message}") }
    }

    private fun wmoCodeToDescription(code: Int) = when (code) {
        0 -> "Céu limpo"; 1 -> "Predominantemente limpo"; 2 -> "Parcialmente nublado"; 3 -> "Nublado"
        45, 48 -> "Névoa"; 51, 53, 55 -> "Garoa"; 61, 63, 65 -> "Chuva"; 66, 67 -> "Chuva com gelo"
        71, 73, 75 -> "Neve"; 77 -> "Granizo"; 80, 81, 82 -> "Pancadas de chuva"
        85, 86 -> "Pancadas de neve"; 95 -> "Tempestade"; 96, 99 -> "Tempestade com granizo"
        else -> "Tempo variável"
    }

    private fun wmoCodeToWeatherId(code: Int) = when (code) {
        0, 1 -> 800; 2, 3, 45, 48 -> 801
        51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82 -> 500
        95, 96, 99 -> 200; else -> 800
    }

    private fun getWeatherBgAsset(weatherId: Int, isNight: Boolean) = if (isNight) {
        if (weatherId in 200..599) "weather/chuva_noite.mp4" else "weather/noite_normal.mp4"
    } else {
        when {
            weatherId in 200..599 -> "weather/dia_chuva.mp4"
            weatherId in 801..899 -> "weather/ceu_nublado.mp4"
            else -> "weather/ceu_limpo.mp4"
        }
    }

    // ==================== RENDERIZADOR: HTML ====================

    @SuppressLint("SetJavaScriptEnabled")
    private fun renderHtml(item: PlaylistItem, nextSlot: FrameLayout) {
        try {
            nextSlot.removeAllViews()
            val webView = WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                setBackgroundColor(Color.BLACK)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?) = true
                }
                loadData(item.html ?: "", "text/html", "UTF-8")
            }
            nextSlot.addView(webView)
            doTransition(nextSlot)
            mainHandler.postDelayed({ webView.destroy(); playNext() }, (item.duration * 1000).toLong())
        } catch (e: Exception) {
            android.util.Log.e("RenderHtml", "Erro: ${e.message}")
            playNext()
        }
    }

    // ==================== TRANSIÇÃO ====================

    private fun doTransition(nextSlot: FrameLayout) {
        val prevSlot = activeSlot
        nextSlot.animate().alpha(1f).setDuration(800).start()
        prevSlot?.animate()?.alpha(0f)?.setDuration(800)?.withEndAction {
            prevSlot.removeAllViews()
            prevSlot.alpha = 0f
        }?.start()
        activeSlot = nextSlot
    }

    // ==================== WATCHDOG ====================

    private fun resetWatchdog() {
        watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        watchdogRunnable = Runnable {
            android.util.Log.w("Watchdog", "Player travado — recuperando")
            try {
                val travado = exoPlayer?.playbackState == Player.STATE_IDLE
                        || exoPlayer?.playbackState == Player.STATE_ENDED
                if (travado) { exoPlayer?.release(); exoPlayer = null }
                playNext()
            } catch (e: Exception) {
                val intent = packageManager.getLaunchIntentForPackage(packageName)
                intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                startActivity(intent)
            }
        }
        mainHandler.postDelayed(watchdogRunnable!!, 90_000)
    }

    // ==================== ORIENTAÇÃO ====================

    private fun applyOrientation(orientation: String) {
        val root = findViewById<View>(R.id.rootLayout)
        root.post {
            val w = root.width.toFloat()
            val h = root.height.toFloat()
            when (orientation) {
                "portrait", "portrait-flipped" -> {
                    val rotation = if (orientation == "portrait") 90f else -90f
                    val params = root.layoutParams
                    params.width = h.toInt(); params.height = w.toInt()
                    root.layoutParams = params
                    root.pivotX = h / 2f; root.pivotY = w / 2f
                    root.rotation = rotation
                    root.translationX = (w - h) / 2f; root.translationY = (h - w) / 2f
                }
                "landscape-flipped" -> {
                    val params = root.layoutParams
                    params.width = w.toInt(); params.height = h.toInt()
                    root.layoutParams = params
                    root.pivotX = w / 2f; root.pivotY = h / 2f
                    root.rotation = 180f; root.translationX = 0f; root.translationY = 0f
                }
                else -> {
                    val params = root.layoutParams
                    params.width = ViewGroup.LayoutParams.MATCH_PARENT
                    params.height = ViewGroup.LayoutParams.MATCH_PARENT
                    root.layoutParams = params
                    root.rotation = 0f; root.translationX = 0f; root.translationY = 0f
                }
            }
        }
    }

    // ==================== LOGO ====================

    private fun applyLogo(logoUrl: String?) {
        val logoView = findViewById<ImageView>(R.id.orgLogo)
        if (!logoUrl.isNullOrEmpty()) {
            Glide.with(this).load(logoUrl).into(logoView)
            logoView.visibility = View.VISIBLE
        } else {
            logoView.visibility = View.GONE
        }
    }

    // ==================== RELÓGIO ====================

    private fun setupClock() {
        val clockTime    = findViewById<TextView>(R.id.clockTime)
        val clockDate    = findViewById<TextView>(R.id.clockDate)
        val offlineBadge = findViewById<TextView>(R.id.offlineBadge)

        val clockRunnable = object : Runnable {
            override fun run() {
                val now = java.util.Calendar.getInstance()
                clockTime.text = String.format("%02d:%02d",
                    now.get(java.util.Calendar.HOUR_OF_DAY), now.get(java.util.Calendar.MINUTE))
                clockTime.setTextColor(Color.WHITE)
                clockTime.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)

                val monthNames = arrayOf("Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez")
                clockDate.text = "${String.format("%02d", now.get(java.util.Calendar.DAY_OF_MONTH))} de ${monthNames[now.get(java.util.Calendar.MONTH)]}"
                clockDate.setTextColor(Color.WHITE)
                clockDate.setTypeface(null, android.graphics.Typeface.BOLD)
                clockDate.setShadowLayer(0f, 0f, 0f, Color.TRANSPARENT)

                val online = try {
                    val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
                        caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
                    } else {
                        @Suppress("DEPRECATION")
                        cm.activeNetworkInfo?.isConnected == true
                    }
                } catch (e: Exception) { true }

                isOffline = !online
                offlineBadge.visibility = if (isOffline) View.VISIBLE else View.GONE
                mainHandler.postDelayed(this, 1_000)
            }
        }
        mainHandler.post(clockRunnable)
    }

    // ==================== TELAS DE SISTEMA ====================

    private fun showLoading(msg: String = "Carregando...") {
        findViewById<View>(R.id.loadingScreen).visibility = View.VISIBLE
        findViewById<TextView>(R.id.loadingText).text = msg
        hideSetupScreen()
    }

    private fun hideLoading() { findViewById<View>(R.id.loadingScreen).visibility = View.GONE }

    private fun showSetupScreen() {
        findViewById<View>(R.id.setupScreen).visibility = View.VISIBLE
        findViewById<TextView>(R.id.pairingCodeText).text = deviceId
        hideLoading()
    }

    private fun hideSetupScreen() { findViewById<View>(R.id.setupScreen).visibility = View.GONE }

    private fun isWithinBusinessHours(businessHours: Map<String, BusinessHour>): Boolean {
        if (businessHours.isEmpty()) return true

        try {
            val calendar = java.util.Calendar.getInstance()
            val dayOfWeek = calendar.get(java.util.Calendar.DAY_OF_WEEK)
            val currentDay = when (dayOfWeek) {
                java.util.Calendar.MONDAY -> "mon"
                java.util.Calendar.TUESDAY -> "tue"
                java.util.Calendar.WEDNESDAY -> "wed"
                java.util.Calendar.THURSDAY -> "thu"
                java.util.Calendar.FRIDAY -> "fri"
                java.util.Calendar.SATURDAY -> "sat"
                java.util.Calendar.SUNDAY -> "sun"
                else -> return true
            }

            val daySchedule = businessHours[currentDay] ?: return true
            if (daySchedule.open.isEmpty() || daySchedule.close.isEmpty()) return true

            val currentMinutes = calendar.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calendar.get(java.util.Calendar.MINUTE)

            fun parseTime(time: String): Int {
                val parts = time.split(":")
                if (parts.size != 2) return 0
                return parts[0].toIntOrNull()?.times(60)?.plus(parts[1].toIntOrNull() ?: 0) ?: 0
            }

            val openMinutes = parseTime(daySchedule.open)
            val closeMinutes = parseTime(daySchedule.close)

            if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
                return true
            }

            val turn2 = daySchedule.turn2
            if (turn2 != null && turn2.open.isNotEmpty() && turn2.close.isNotEmpty()) {
                val open2Minutes = parseTime(turn2.open)
                val close2Minutes = parseTime(turn2.close)
                if (currentMinutes >= open2Minutes && currentMinutes < close2Minutes) {
                    return true
                }
            }

            return false
        } catch (e: Exception) {
            android.util.Log.w("BusinessHours", "Erro ao verificar horário: ${e.message}")
            return true
        }
    }

    private var outsideHoursView: View? = null

    private fun showOutsideBusinessHours() {
        if (outsideHoursView != null) return

        val rootView = findViewById<ViewGroup>(android.R.id.content)
        outsideHoursView = layoutInflater.inflate(R.layout.outside_business_hours, rootView, false)
        rootView.addView(outsideHoursView)
        isPlaying = false
    }

    private fun hideOutsideBusinessHours() {
        outsideHoursView?.let {
            val rootView = findViewById<ViewGroup>(android.R.id.content)
            rootView.removeView(it)
        }
        outsideHoursView = null
    }

    // ==================== KIOSK E FULLSCREEN ====================

    private fun startKioskMode() { try { startLockTask() } catch (e: Exception) {} }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableFullscreen()
    }

    private fun enableFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.hide(
                android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars()
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    )
        }
    }

    // ==================== TOQUE SECRETO ====================

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
        if (ev?.action == MotionEvent.ACTION_DOWN) {
            val now = System.currentTimeMillis()
            if (now - lastTapTime > 3_000) tapCount = 0
            tapCount++; lastTapTime = now
            if (tapCount >= 5) { tapCount = 0; showAdminModal() }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun showAdminModal() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                    android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "PIN"
        }
        AlertDialog.Builder(this).setTitle("Administrador").setView(input).setCancelable(false)
            .setPositiveButton("Confirmar") { _, _ ->
                if (input.text.toString() == "1234") showAdminActions()
                else Toast.makeText(this, "PIN incorreto", Toast.LENGTH_SHORT).show()
            }.setNegativeButton("Cancelar", null).show()
    }

    private fun showAdminActions() {
        AlertDialog.Builder(this).setTitle("O que deseja fazer?").setCancelable(false)
            .setItems(arrayOf("🔄 Recarregar Player", "🚪 Sair para o Android")) { _, which ->
                when (which) {
                    0 -> {
                        isPlaying = false; currentIndex = -1; playlist = listOf()
                        activeSlot?.removeAllViews(); activeSlot = null
                        exoPlayer?.release(); exoPlayer = null
                        mainHandler.removeCallbacksAndMessages(null)
                        setupClock(); showLoading("Reiniciando...")
                        bgExecutor.execute { syncAndPlay() }
                    }
                    1 -> {
                        try { stopLockTask() } catch (e: Exception) {}
                        startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
                    }
                }
            }.show()
    }
}