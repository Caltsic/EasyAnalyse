package cn.easyanalyse.mobile.net

import cn.easyanalyse.mobile.model.MobileRenderSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

class SnapshotRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    suspend fun fetch(url: String): MobileRenderSnapshot = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = body.takeIf { it.isNotBlank() } ?: "HTTP ${response.code}"
                throw IOException(message)
            }
            json.decodeFromString<MobileRenderSnapshot>(body)
        }
    }
}
