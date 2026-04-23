package cn.easyanalyse.mobile.net

import android.net.Uri

object SnapshotUrlResolver {
    fun resolve(rawValue: String?): String? {
        val raw = rawValue?.trim().orEmpty()
        if (raw.isEmpty()) {
            return null
        }

        val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
        if (uri.scheme == "easyanalyse" && uri.host == "open") {
            return resolve(uri.getQueryParameter("url"))
        }

        if (uri.scheme != "http" && uri.scheme != "https") {
            return null
        }

        if (uri.path?.startsWith("/api/mobile/snapshot/") == true) {
            return raw
        }

        if (uri.path == "/viewer") {
            val token = uri.getQueryParameter("token")?.trim()
            if (!token.isNullOrEmpty()) {
                return uri.buildUpon()
                    .path("/api/mobile/snapshot/$token")
                    .clearQuery()
                    .fragment(null)
                    .build()
                    .toString()
            }
        }

        return raw
    }
}
