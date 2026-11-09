package ai.parkiq.vehicle

import android.content.Context
import android.os.Handler
import android.os.Looper
import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointCmdType
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import org.json.JSONObject

/** Uses the official NaviHelper 3.0.5 SDK; success requires a navigation callback. */
class PleosNavigation(context: Context) {
    private val helper = NaviHelper(context.applicationContext)
    private val handler = Handler(Looper.getMainLooper())
    private var connected = false
    private var pending: ((Boolean, String) -> Unit)? = null
    private var pendingCancel = false
    private var pendingWaypoint = false
    private val timeout = Runnable { finish(false, "차량 내비게이션 응답 시간이 초과되었습니다.") }
    private val listener = object : NaviHelperEventListener {
        override fun onRoutingCompleted() { if (!pendingCancel && !pendingWaypoint) finish(true, "route_ready") }
        override fun onRouteCancelled() { if (pendingCancel) finish(true, "route_cancelled") }
        override fun onWaypointChanged(info: WaypointChangedInfo) {
            if (pendingWaypoint && info.index == WaypointIndex.FIRST && info.cmdType == WaypointCmdType.ADD)
                finish(true, "waypoint_added")
        }
        override fun onError(errorCode: NaviErrorCode) { finish(false, "내비게이션 오류: $errorCode") }
    }
    init {
        helper.initialize(onConnected = {
            connected = true
            helper.addListener(listener)
        }, onFailed = { connected = false })
    }
    private fun finish(ok: Boolean, message: String) {
        handler.post {
            handler.removeCallbacks(timeout)
            val callback = pending
            pending = null
            callback?.invoke(ok, message)
        }
    }
    fun start(parking: JSONObject, asWaypoint: Boolean = false, callback: (Boolean, String) -> Unit) {
        if (!connected) { callback(false, "Pleos 내비게이션이 연결되지 않았습니다."); return }
        if (pending != null) { callback(false, "다른 경로 요청을 처리 중입니다."); return }
        if (parking.optBoolean("demo", true)) { callback(false, "시연 주차장을 실제 차량으로 안내할 수 없습니다."); return }
        val lat = parking.optDouble("lat", Double.NaN)
        val lng = parking.optDouble("lng", Double.NaN)
        if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) {
            callback(false, "주차장 좌표가 유효하지 않습니다."); return
        }
        pending = callback; pendingCancel = false; pendingWaypoint = asWaypoint
        handler.postDelayed(timeout, 5000)
        try {
            if (asWaypoint) {
                // Preserves the existing destination; requires an active route in Navi Service.
                helper.addWaypoint(RequestWaypointInfo(latitude = lat, longitude = lng,
                    waypointIndex = WaypointIndex.FIRST, poiName = parking.getString("name"),
                    poiId = "", poiSubId = "0", address = parking.optString("address")))
            } else {
                // Stop driving at the parking facility. The final venue is reached on foot.
                helper.requestRoute(RouteInfo(latitude = lat, longitude = lng,
                    poiName = parking.getString("name"), poiId = "", poiSubId = "0",
                    address = parking.optString("address")))
            }
        } catch (_: Exception) { finish(false, "경로 요청에 실패했습니다.") }
    }
    fun cancel(callback: (Boolean, String) -> Unit) {
        if (!connected) { callback(false, "Pleos 내비게이션이 연결되지 않았습니다."); return }
        if (pending != null) { callback(false, "다른 경로 요청을 처리 중입니다."); return }
        pending = callback; pendingCancel = true; pendingWaypoint = false
        handler.postDelayed(timeout, 5000)
        try { helper.cancelRoute() } catch (_: Exception) { finish(false, "경로 취소에 실패했습니다.") }
    }
    fun release() { handler.removeCallbacks(timeout); helper.removeListener(listener); helper.release() }
}
