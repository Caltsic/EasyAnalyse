package cn.easyanalyse.mobile.render

sealed class CircuitSelection {
    data class Device(val id: String) : CircuitSelection()
    data class NetworkLine(val id: String) : CircuitSelection()
}
