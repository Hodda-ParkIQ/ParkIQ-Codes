package ai.parkiq.vehicle

import android.Manifest
import android.app.Activity
import android.car.Car
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import org.json.JSONTokener
import java.util.Locale
import java.util.UUID
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity : Activity(), LocationListener {
    private lateinit var web: WebView
    private lateinit var navigation: PleosNavigation
    private val backendTransport = BackendTransport()
    private val backendExecutor = Executors.newFixedThreadPool(4)
    private var destroyed = false
    private val appOrigin = "https://appassets.androidplatform.net"
    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var car: Car? = null
    private var properties: CarPropertyManager? = null
    private var uxManager: CarUxRestrictionsManager? = null
    private var uxRestricted: Boolean? = null
    private var carReady = false
    private var speed: Float? = null
    private var speechRequestId: String? = null
    private var location: Location? = null
    private var pageReady = false
    private var ttsReady = false
    private val gleoPending = mutableMapOf<String, String>()
    private val gleoDelivered = mutableSetOf<String>()
    private val gleoPayloads = mutableMapOf<String, JSONObject>()
    private val actions = setOf("SEARCH_PARKING", "START_PARKING_ROUTE", "CANCEL_PARKING_ROUTE")
    private val uxListener = CarUxRestrictionsManager.OnUxRestrictionsChangedListener { restrictions ->
        uxRestricted = restrictions.isRequiresDistractionOptimization
        publishVehicle()
    }
    private val speedCallback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            if (value.propertyId == VehiclePropertyIds.PERF_VEHICLE_SPEED) {
                speed = if (value.status == CarPropertyValue.STATUS_AVAILABLE) (value.value as? Float) else null
                publishVehicle()
            }
        }
        override fun onErrorEvent(propId: Int, zone: Int) { speed = null; publishVehicle() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        navigation = PleosNavigation(this)
        tts = TextToSpeech(this) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.KOREAN
        }
        web = WebView(this)
        web.setBackgroundColor(0xffffffff.toInt())
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.javaScriptCanOpenWindowsAutomatically = false
        web.addJavascriptInterface(Bridge(), "ParkIQNative")
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isTrusted(request.url.toString())
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") {
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(byteArrayOf()))
                }
                return assetLoader.shouldInterceptRequest(uri)
                    ?: WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (isTrusted(url)) {
                    pageReady = true; publishVehicle()
                    gleoPending.keys.toList().forEach { deliverGleo(it) }
                }
            }
        }
        setContentView(web)
        web.loadUrl("$appOrigin/index.html")
        requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.RECORD_AUDIO, Car.PERMISSION_SPEED), 100)
        connectVehicle()
        handleGleo(intent)
    }
    private fun connectVehicle() {
        try {
            if (car == null) {
                car = Car.createCar(this, handler, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { activeCar, ready ->
                    carReady = ready
                    if (ready) bindVehicle(activeCar) else {
                        uxRestricted = null; speed = null; properties = null; uxManager = null
                        publishVehicle()
                    }
                }
            } else if (carReady) car?.let { bindVehicle(it) }
        } catch (_: Exception) { uxRestricted = null; speed = null; publishVehicle() }
    }
    private fun bindVehicle(activeCar: Car) {
        try {
            uxManager?.unregisterListener()
            uxManager = activeCar.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
            uxRestricted = uxManager?.currentCarUxRestrictions?.isRequiresDistractionOptimization
            uxManager?.registerListener(uxListener)
        } catch (_: Exception) { uxRestricted = null }
        try {
            properties = activeCar.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager
            properties?.registerCallback(speedCallback, VehiclePropertyIds.PERF_VEHICLE_SPEED,
                CarPropertyManager.SENSOR_RATE_ONCHANGE)
        } catch (_: Exception) { speed = null }
        publishVehicle()
    }
    private fun isTrusted(url: String): Boolean {
        val actual = Uri.parse(url)
        return actual.scheme == "https" && actual.host == "appassets.androidplatform.net" &&
            actual.port in listOf(-1, 443) && actual.path == "/index.html"
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        connectVehicle()
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            try {
                (getSystemService(LOCATION_SERVICE) as LocationManager).requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, 5000L, 10f, this)
            } catch (_: Exception) { /* No location is safer than a fabricated vehicle position. */ }
        }
    }
    override fun onLocationChanged(value: Location) { location = value; publishVehicle() }
    private fun publishVehicle() {
        if (!pageReady) return
        // Use the platform UX restriction; missing platform/speed data keeps the input lock on.
        val currentSpeed = speed
        val restricted = uxRestricted ?: (currentSpeed == null || kotlin.math.abs(currentSpeed) > 0.1f)
        val state = JSONObject().put("moving", restricted)
        location?.let { state.put("origin", JSONObject().put("lat", it.latitude).put("lng", it.longitude)) }
        emit("parkiq:vehicle", state)
    }
    private fun emit(name: String, payload: JSONObject) {
        handler.post {
            if (destroyed) return@post
            if (!isTrusted(web.url ?: "")) return@post
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent(${JSONObject.quote(name)}, {detail:$payload}));", null)
        }
    }
    private fun reply(id: String, ok: Boolean, value: Any? = null) {
        val obj = JSONObject().put("id", id).put("ok", ok)
        obj.put(if (ok) "data" else "error", value ?: JSONObject.NULL)
        emit("parkiq:native-reply", obj)
    }
    inner class Bridge {
        @JavascriptInterface fun getDefaultBackendUrl(): String = BuildConfig.BACKEND_API_URL
        @JavascriptInterface fun postMessage(raw: String) {
            if (raw.length > 32768) return
            handler.post {
                if (destroyed || !isTrusted(web.url ?: "")) return@post
                val msg = runCatching { JSONObject(raw) }.getOrNull() ?: return@post
                val id = msg.optString("id").take(100)
                val params = msg.optJSONObject("params") ?: JSONObject()
                when (msg.optString("method")) {
                    "backend.request" -> backendExecutor.execute {
                        try { reply(id, true, backendTransport.request(params)) }
                        catch (error: IllegalArgumentException) { reply(id, false, error.message ?: "서버 주소가 올바르지 않습니다.") }
                        catch (_: Exception) { reply(id, false, "서버에 연결할 수 없습니다. 서버 주소와 네트워크를 확인하세요.") }
                    }
                    "vehicle.state" -> { publishVehicle(); reply(id, true) }
                    "navigation.start", "navigation.addWaypoint" -> {
                        val parking = params.optJSONObject("parking")
                        if (parking == null) reply(id, false, "주차장 정보가 없습니다.")
                        else navigation.start(parking, msg.optString("method") == "navigation.addWaypoint") { ok, message -> reply(id, ok, message) }
                    }
                    "navigation.cancel" -> navigation.cancel { ok, message -> reply(id, ok, message) }
                    "voice.listen" -> listen(id)
                    "voice.cancel" -> { cancelSpeech(); reply(id, true) }
                    "voice.speak" -> {
                        if (ttsReady) { tts?.speak(params.optString("text").take(500), TextToSpeech.QUEUE_FLUSH, null, id); reply(id, true) }
                        else reply(id, false, "음성 합성이 준비되지 않았습니다.")
                    }
                    "gleo.respond" -> {
                        val callId = params.optString("id")
                        val action = gleoPending.remove(callId)
                        gleoDelivered.remove(callId); gleoPayloads.remove(callId)
                        if (action != null) sendGleo(action, params.optString("status", "fail"),
                            params.optString("message"), params.optString("data", "[]"))
                        reply(id, action != null)
                    }
                    else -> reply(id, false, "지원하지 않는 차량 요청입니다.")
                }
            }
        }
    }
    private fun listen(id: String) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
            !SpeechRecognizer.isRecognitionAvailable(this)) { reply(id, false, "차량 음성 인식을 사용할 수 없습니다."); return }
        cancelSpeech()
        speechRequestId = id
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    if (speechRequestId != id) return
                    speechRequestId = null
                    val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    reply(id, text != null, text ?: "음성을 인식하지 못했습니다.")
                }
                override fun onError(error: Int) {
                    if (speechRequestId == id) {
                        speechRequestId = null
                        reply(id, false, "음성 인식 오류: $error")
                    }
                }
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
            })
        }
    }
    private fun cancelSpeech() {
        val id = speechRequestId
        speechRequestId = null
        recognizer?.cancel(); recognizer?.destroy(); recognizer = null
        if (id != null) reply(id, false, "음성 검색을 종료했습니다.")
    }
    override fun onStop() {
        if (::web.isInitialized) cancelSpeech()
        super.onStop()
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleGleo(intent) }
    private fun handleGleo(intent: Intent?) {
        val action = intent?.action ?: return
        if (action !in actions) return
        val params = runCatching {
            val raw = intent.getStringExtra("ACTION_PARAM")
            if (raw != null) {
                val value = JSONTokener(raw).nextValue()
                if (value is JSONObject) value else JSONObject(value.toString())
            } else JSONObject().apply {
                listOf("query", "preference", "rank").forEach { key ->
                    @Suppress("DEPRECATION") val value = intent.extras?.get(key)
                    if (value != null) put(key, value)
                }
            }
        }.getOrElse { sendGleo(action, "fail", "Invalid action parameters."); return }
        val id = UUID.randomUUID().toString()
        gleoPending[id] = action; gleoPayloads[id] = params
        deliverGleo(id)
        handler.postDelayed({
            val pending = gleoPending.remove(id)
            gleoDelivered.remove(id); gleoPayloads.remove(id)
            if (pending != null) sendGleo(pending, "fail", "The parking action timed out.")
        }, 6200)
    }
    private fun deliverGleo(id: String) {
        if (!pageReady || id in gleoDelivered) return
        val action = gleoPending[id] ?: return
        gleoDelivered.add(id)
        emit("parkiq:gleo", JSONObject().put("id", id).put("action", action)
            .put("parameters", gleoPayloads[id] ?: JSONObject()))
    }
    private fun sendGleo(action: String, status: String, message: String, data: String = "[]") {
        val validStatus = status.takeIf { it in setOf("success", "asking", "fail") } ?: "fail"
        val response = JSONObject().put("functionName", action).put("status", validStatus)
            .put("message", message).put("data", data)
        sendBroadcast(Intent("ai.pleos.playground.intent.action.APP_ACTION_RESPONSE")
            .putExtra("packageName", packageName).putExtra("response", response.toString()))
    }
    override fun onDestroy() {
        destroyed = true
        backendExecutor.shutdownNow()
        (getSystemService(LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        runCatching { uxManager?.unregisterListener() }
        runCatching { properties?.unregisterCallback(speedCallback) }
        car?.disconnect()
        navigation.release(); recognizer?.destroy(); tts?.shutdown()
        handler.removeCallbacksAndMessages(null)
        web.removeJavascriptInterface("ParkIQNative"); web.destroy()
        super.onDestroy()
    }
}
