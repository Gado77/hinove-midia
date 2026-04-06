package com.loopin.loopintv

import android.content.Context
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

data class PlaylistItem(
    val id: String,
    val name: String,
    val renderType: String,
    val mediaType: String? = null,
    val url: String? = null,
    val campaignId: String? = null,
    val text: String? = null,
    val bgColor: String? = null,
    val textColor: String? = null,
    val city: String? = null,
    val html: String? = null,
    val duration: Int = 10,
    val order: Int = 0
)

data class ScreenSettings(
    val userId: String = "",
    val screenUuid: String = "",
    val orientation: String = "landscape",
    val orgLogoUrl: String? = null,
    val weatherApiKey: String? = null,
    val isMuted: Boolean = false
)

data class ScreenCommand(
    val id: String,
    val command: String,
    val payload: String = ""
)

class SupabaseManager(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun get(endpoint: String): JSONArray? {
        return try {
            val request = Request.Builder()
                .url("${SupabaseConfig.URL}${endpoint}")
                .addHeader("apikey", SupabaseConfig.API_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.API_KEY}")
                .addHeader("Accept", "application/json")
                .get()
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: return null
                JSONArray(body)
            }
        } catch (e: Exception) {
            android.util.Log.e("SupabaseManager", "GET error: ${e.message}")
            null
        }
    }

    fun isScreenRegistered(deviceId: String): Boolean {
        val result = get("/screens?device_id=eq.${deviceId}&select=id") ?: return false
        return result.length() > 0
    }

    fun loadSettings(deviceId: String): ScreenSettings {
        try {
            val screens = get("/screens?device_id=eq.${deviceId}&select=id,user_id,orientation,is_muted") ?: return ScreenSettings()
            if (screens.length() == 0) return ScreenSettings()

            val screen = screens.getJSONObject(0)
            val screenUuid = screen.optString("id", "")
            val userId = screen.optString("user_id", "")
            val orientation = screen.optString("orientation", "landscape")
            val isMuted = screen.optBoolean("is_muted", false)

            if (userId.isEmpty()) return ScreenSettings(orientation = orientation, isMuted = isMuted)

            val settings = get("/settings?user_id=eq.${userId}&select=organization_logo_url,api_weather_key")
            val settingsObj = settings?.optJSONObject(0)

            return ScreenSettings(
                userId = userId,
                screenUuid = screenUuid,
                orientation = orientation,
                orgLogoUrl = settingsObj?.optString("organization_logo_url"),
                weatherApiKey = settingsObj?.optString("api_weather_key"),
                isMuted = isMuted
            )
        } catch (e: Exception) {
            android.util.Log.e("SupabaseManager", "loadSettings error: ${e.message}")
            return ScreenSettings()
        }
    }

    fun fetchPlaylist(deviceId: String): List<PlaylistItem> {
        val items = mutableListOf<PlaylistItem>()

        try {
            val screens = get(
                "/screens?device_id=eq.${deviceId}&select=active_playlist_id"
            ) ?: return items

            if (screens.length() == 0) return items
            val playlistId = screens.getJSONObject(0).optString("active_playlist_id", "")
            if (playlistId.isEmpty()) return items

            val campaigns = get(
                "/playlist_items?playlist_id=eq.${playlistId}" +
                        "&campaign_id=not.is.null" +
                        "&select=id,campaign_id,duration,display_order,campaigns!campaign_id(id,name,media_url,media_type,duration_seconds)" +
                        "&order=display_order.asc"
            )

            campaigns?.let { arr ->
                for (i in 0 until arr.length()) {
                    val item = arr.getJSONObject(i)
                    val campaign = item.optJSONObject("campaigns") ?: continue
                    val mediaUrl = campaign.optString("media_url", "")
                    if (mediaUrl.isEmpty()) continue

                    val duration = when {
                        item.has("duration") && !item.isNull("duration") -> item.getInt("duration")
                        campaign.has("duration_seconds") && !campaign.isNull("duration_seconds") -> campaign.getInt("duration_seconds")
                        else -> 10
                    }

                    items.add(PlaylistItem(
                        id         = campaign.optString("id"),
                        name       = campaign.optString("name", "Midia"),
                        renderType = "media",
                        mediaType  = campaign.optString("media_type", "image"),
                        url        = mediaUrl,
                        campaignId = campaign.optString("id"),
                        duration   = duration,
                        order      = item.optInt("display_order", 0)
                    ))
                }
            }

            val widgets = get(
                "/playlist_items?playlist_id=eq.${playlistId}" +
                        "&widget_id=not.is.null" +
                        "&select=id,widget_id,duration,display_order,dynamic_contents!widget_id(id,name,content_type,configuration)" +
                        "&order=display_order.asc"
            )

            widgets?.let { arr ->
                for (i in 0 until arr.length()) {
                    val item = arr.getJSONObject(i)
                    val widget = item.optJSONObject("dynamic_contents") ?: continue
                    val contentType = widget.optString("content_type", "").lowercase()
                    val duration = if (item.has("duration") && !item.isNull("duration")) item.getInt("duration") else 15

                    val config: JSONObject = try {
                        val raw = widget.opt("configuration")
                        when (raw) {
                            is String -> JSONObject(raw)
                            is JSONObject -> raw
                            else -> JSONObject()
                        }
                    } catch (e: Exception) { JSONObject() }

                    when (contentType) {
                        "ticker", "text", "news" -> {
                            val text = config.optString("text", "").ifEmpty {
                                if (contentType == "news") "Noticias: ${config.optString("category", "Gerais")}"
                                else "Texto vazio"
                            }
                            items.add(PlaylistItem(
                                id         = widget.optString("id"),
                                name       = widget.optString("name", "Texto"),
                                renderType = "text",
                                text       = text,
                                bgColor    = config.optString("bg_color", "#000000"),
                                textColor  = config.optString("text_color", "#ffffff"),
                                duration   = duration,
                                order      = item.optInt("display_order", 0)
                            ))
                        }
                        "weather", "clima" -> {
                            items.add(PlaylistItem(
                                id         = widget.optString("id"),
                                name       = widget.optString("name", "Clima"),
                                renderType = "weather",
                                city       = config.optString("city", "Sao Paulo"),
                                duration   = duration,
                                order      = item.optInt("display_order", 0)
                            ))
                        }
                        "html" -> {
                            items.add(PlaylistItem(
                                id         = widget.optString("id"),
                                name       = widget.optString("name", "HTML"),
                                renderType = "html",
                                html       = config.optString("html", ""),
                                duration   = duration,
                                order      = item.optInt("display_order", 0)
                            ))
                        }
                    }
                }
            }

        } catch (e: Exception) {
            android.util.Log.e("SupabaseManager", "fetchPlaylist error: ${e.message}")
        }

        return items.sortedBy { it.order }
    }

    fun logPlayback(screenUuid: String, userId: String, campaignId: String, durationSeconds: Int) {
        try {
            val json = JSONObject().apply {
                put("screen_id", screenUuid)
                put("user_id", userId)
                put("campaign_id", campaignId)
                put("duration_seconds", durationSeconds)
            }

            val body = json.toString().toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("${SupabaseConfig.URL}/playback_logs")
                .post(body)
                .addHeader("apikey", SupabaseConfig.API_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.API_KEY}")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .build()

            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: java.io.IOException) {
                    android.util.Log.w("Playback", "Falha ao registrar log: ${e.message}")
                }
                override fun onResponse(call: Call, response: Response) {
                    android.util.Log.d("Playback", "Log registrado campaign=${campaignId}")
                    response.close()
                }
            })
        } catch (e: Exception) {
            android.util.Log.w("Playback", "Erro ao registrar log: ${e.message}")
        }
    }

    fun downloadMedia(url: String): String? {
        if (url.isEmpty()) return null

        val fileName = url.substringAfterLast("/").substringBefore("?")
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val file = File(context.filesDir, fileName)

        if (file.exists() && file.length() > 0) {
            android.util.Log.d("SupabaseManager", "Cache hit: ${fileName}")
            return file.absolutePath
        }

        return try {
            android.util.Log.d("SupabaseManager", "Baixando: ${fileName}")
            val request = Request.Builder().url(url).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                response.body?.byteStream()?.use { input ->
                    FileOutputStream(file).use { output -> input.copyTo(output) }
                }
            }
            enforceCacheLimit()
            file.absolutePath
        } catch (e: Exception) {
            android.util.Log.e("SupabaseManager", "Download error: ${e.message}")
            file.delete()
            null
        }
    }

    private fun enforceCacheLimit(limitMb: Long = 500) {
        try {
            val files = context.filesDir.listFiles() ?: return
            val limitBytes = limitMb * 1024 * 1024
            val totalBytes = files.sumOf { it.length() }

            if (totalBytes <= limitBytes) return

            val sorted = files.sortedBy { it.lastModified() }
            var freed = 0L
            for (file in sorted) {
                if (totalBytes - freed <= limitBytes) break
                freed += file.length()
                file.delete()
                android.util.Log.d("SupabaseManager", "Cache: removido ${file.name}")
            }
            android.util.Log.d("SupabaseManager", "Cache: ${freed / 1024 / 1024}MB liberados")
        } catch (e: Exception) {
            android.util.Log.w("SupabaseManager", "enforceCacheLimit error: ${e.message}")
        }
    }

    fun sendPing(deviceId: String, currentContent: String = "", cacheUsedMb: Int = 0, playlistItemsCount: Int = 0) {
        try {
            val json = JSONObject().apply { 
                put("status", "online")
                put("last_ping", "now()")
                put("current_content", currentContent)
                put("cache_used_mb", cacheUsedMb)
                put("playlist_items_count", playlistItemsCount)
            }
            val body = json.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("${SupabaseConfig.URL}/screens?device_id=eq.${deviceId}")
                .patch(body)
                .addHeader("apikey", SupabaseConfig.API_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.API_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: java.io.IOException) {}
                override fun onResponse(call: Call, response: Response) { response.close() }
            })
        } catch (e: Exception) {}
    }

    fun sendLog(screenUuid: String, eventType: String, message: String = "", metadata: JSONObject = JSONObject()) {
        if (screenUuid.isEmpty()) return
        try {
            val json = JSONObject().apply {
                put("screen_id", screenUuid)
                put("event_type", eventType)
                put("message", message)
                put("metadata", metadata)
            }
            val body = json.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("${SupabaseConfig.URL}/player_logs")
                .post(body)
                .addHeader("apikey", SupabaseConfig.API_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.API_KEY}")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .build()
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: java.io.IOException) {
                    android.util.Log.w("SupabaseManager", "sendLog failed: ${e.message}")
                }
                override fun onResponse(call: Call, response: Response) { response.close() }
            })
        } catch (e: Exception) {
            android.util.Log.w("SupabaseManager", "sendLog error: ${e.message}")
        }
    }

    fun getCacheUsedMb(): Int {
        return try {
            val files = context.filesDir.listFiles() ?: return 0
            val totalBytes = files.sumOf { it.length() }
            (totalBytes / 1024 / 1024).toInt()
        } catch (e: Exception) {
            android.util.Log.w("SupabaseManager", "getCacheUsedMb error: ${e.message}")
            0
        }
    }

    fun fetchPendingCommand(screenUuid: String): ScreenCommand? {
        return try {
            val url = "/screen_commands?screen_id=eq.${screenUuid}&executed_at=is.null&order=created_at.asc&limit=1"
            android.util.Log.d("LoopinDEBUG", "Polling comandos: $url")
            val result = get(url)
            android.util.Log.d("LoopinDEBUG", "Polling comandos result: " + (result?.toString() ?: "null"))
            if (result == null || result.length() == 0) return null
            
            val obj = result.getJSONObject(0)
            ScreenCommand(
                id = obj.optString("id"),
                command = obj.optString("command"),
                payload = obj.optString("payload", "")
            )
        } catch (e: Exception) {
            android.util.Log.w("LoopinDEBUG", "fetchPendingCommand error: ${e.message}")
            null
        }
    }

    fun markCommandExecuted(commandId: String) {
        try {
            val timestamp = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.format(java.util.Date())
            val json = JSONObject().apply {
                put("executed_at", timestamp)
                put("status", "executed")
            }
            val body = json.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("${SupabaseConfig.URL}/screen_commands?id=eq.${commandId}")
                .patch(body)
                .addHeader("apikey", SupabaseConfig.API_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.API_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: java.io.IOException) {
                    android.util.Log.w("Command", "Falha ao marcar comando: ${e.message}")
                }
                override fun onResponse(call: Call, response: Response) {
                    android.util.Log.d("Command", "Comando marcado como executado: ${commandId}")
                    response.close()
                }
            })
        } catch (e: Exception) {
            android.util.Log.w("SupabaseManager", "markCommandExecuted error: ${e.message}")
        }
    }

    fun cleanupOldMedia(activeUrls: List<String>) {
        try {
            val activeFileNames = activeUrls.mapNotNull { url ->
                if (url.isEmpty()) return@mapNotNull null
                url.substringAfterLast("/").substringBefore("?")
                    .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            }.toSet()

            val allFiles = context.filesDir.listFiles() ?: return
            var deletedCount = 0
            var freedBytes = 0L

            allFiles.forEach { file ->
                if (file.name !in activeFileNames) {
                    freedBytes += file.length()
                    file.delete()
                    deletedCount++
                }
            }

            if (deletedCount > 0) {
                android.util.Log.d("SupabaseManager",
                    "Limpeza: ${deletedCount} arquivos removidos, ${freedBytes / 1024 / 1024}MB liberados")
            }
        } catch (e: Exception) {
            android.util.Log.w("SupabaseManager", "Erro na limpeza: ${e.message}")
        }
    }
}
