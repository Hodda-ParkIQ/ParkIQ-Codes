package ai.parkiq.vehicle

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** JSON API transport from bundled UI to the explicitly configured backend. */
class BackendTransport {
    fun request(params: JSONObject): JSONObject {
        val base = params.getString("baseUrl").trimEnd('/')
        val uri = URI(base)
        require(uri.scheme in setOf("http", "https") && uri.host != null &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
            "서버 주소가 올바르지 않습니다."
        }
        require(BuildConfig.DEBUG || uri.scheme == "https") { "릴리스 앱은 HTTPS 서버를 사용해야 합니다." }
        val path = params.getString("path")
        val method = params.optString("method", "GET")
        val allowed = mapOf("/health" to "GET", "/places" to "GET",
            "/recommendations" to "POST", "/voice/interpret" to "POST")
        require(allowed[path] == method) { "지원하지 않는 API 요청입니다." }
        val connection = URL("$base/api$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 4000
            connection.readTimeout = 6000
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            if (method == "POST") {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(params.optString("body", "{}").toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val body = StringBuilder()
            stream?.bufferedReader(Charsets.UTF_8)?.use { reader ->
                val buffer = CharArray(4096)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    require(body.length + count <= 2_000_000) { "서버 응답이 너무 큽니다." }
                    body.append(buffer, 0, count)
                }
            }
            return JSONObject().put("status", status).put("body", body.toString())
        } finally { connection.disconnect() }
    }
}
