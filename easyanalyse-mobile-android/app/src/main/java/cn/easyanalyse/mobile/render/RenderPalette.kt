package cn.easyanalyse.mobile.render

import android.graphics.Color

data class RenderPalette(
    val background: Int,
    val gridMinor: Int,
    val gridMajor: Int,
    val deviceFill: Int,
    val deviceStroke: Int,
    val deviceSelected: Int,
    val textPrimary: Int,
    val textSecondary: Int,
    val terminalFallback: Int,
    val networkFallback: Int,
    val panelBackground: Int,
)

fun lightRenderPalette() = RenderPalette(
    background = Color.rgb(255, 255, 255),
    gridMinor = Color.rgb(226, 232, 240),
    gridMajor = Color.rgb(203, 213, 225),
    deviceFill = Color.rgb(255, 255, 255),
    deviceStroke = Color.rgb(15, 23, 42),
    deviceSelected = Color.rgb(37, 99, 235),
    textPrimary = Color.rgb(15, 23, 42),
    textSecondary = Color.rgb(71, 85, 105),
    terminalFallback = Color.rgb(37, 99, 235),
    networkFallback = Color.rgb(71, 85, 105),
    panelBackground = Color.rgb(248, 250, 252),
)

fun darkRenderPalette() = RenderPalette(
    background = Color.rgb(17, 20, 22),
    gridMinor = Color.rgb(43, 52, 58),
    gridMajor = Color.rgb(63, 76, 84),
    deviceFill = Color.rgb(28, 34, 38),
    deviceStroke = Color.rgb(222, 232, 238),
    deviceSelected = Color.rgb(96, 165, 250),
    textPrimary = Color.rgb(238, 246, 249),
    textSecondary = Color.rgb(166, 183, 191),
    terminalFallback = Color.rgb(96, 165, 250),
    networkFallback = Color.rgb(166, 183, 191),
    panelBackground = Color.rgb(25, 30, 34),
)

fun parseColorOrFallback(value: String?, fallback: Int): Int {
    if (value.isNullOrBlank()) {
        return fallback
    }
    return runCatching { Color.parseColor(value) }.getOrDefault(fallback)
}
