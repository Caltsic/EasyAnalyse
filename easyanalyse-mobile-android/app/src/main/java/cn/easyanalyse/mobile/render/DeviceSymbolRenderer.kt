package cn.easyanalyse.mobile.render

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import cn.easyanalyse.mobile.model.SnapshotBounds
import cn.easyanalyse.mobile.model.SnapshotDevice
import cn.easyanalyse.mobile.model.SnapshotSymbolPrimitive
import kotlin.math.min

class DeviceSymbolRenderer {
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
    }
    private val rect = RectF()
    private val path = Path()

    fun draw(
        canvas: Canvas,
        device: SnapshotDevice,
        palette: RenderPalette,
        scale: Float,
        selected: Boolean,
        alpha: Int,
    ) {
        val bounds = device.bounds
        canvas.save()
        canvas.rotate(device.rotationDeg, bounds.x + bounds.width / 2f, bounds.y + bounds.height / 2f)

        if (device.symbolPrimitives.isNotEmpty()) {
            drawDedicatedHalo(canvas, bounds, palette, scale, selected, alpha)
            for (primitive in device.symbolPrimitives) {
                drawPrimitive(canvas, primitive, bounds, device, palette, alpha)
            }
        } else {
            drawBody(canvas, device, palette, scale, selected, alpha)
            drawDedicatedSymbol(canvas, device, palette, scale, alpha)
        }

        canvas.restore()
        resetAlpha()
    }

    private fun drawDedicatedHalo(
        canvas: Canvas,
        bounds: SnapshotBounds,
        palette: RenderPalette,
        scale: Float,
        selected: Boolean,
        alpha: Int,
    ) {
        if (!selected) {
            return
        }
        strokePaint.color = palette.deviceSelected
        strokePaint.strokeWidth = 2f / scale
        strokePaint.alpha = alpha
        strokePaint.pathEffect = DashPathEffect(floatArrayOf(16f / scale, 12f / scale), 0f)
        rect.set(bounds.x + 10f, bounds.y + 8f, bounds.x + bounds.width - 10f, bounds.y + bounds.height - 8f)
        canvas.drawRoundRect(rect, 18f, 18f, strokePaint)
        strokePaint.pathEffect = null
    }

    private fun drawPrimitive(
        canvas: Canvas,
        primitive: SnapshotSymbolPrimitive,
        bounds: SnapshotBounds,
        device: SnapshotDevice,
        palette: RenderPalette,
        alpha: Int,
    ) {
        when (primitive.type) {
            "line" -> drawPrimitiveLine(canvas, primitive, bounds, device, palette, alpha)
            "rect" -> drawPrimitiveRect(canvas, primitive, bounds, device, palette, alpha)
            "circle" -> drawPrimitiveCircle(canvas, primitive, bounds, device, palette, alpha)
            "text" -> drawPrimitiveText(canvas, primitive, bounds, device, palette, alpha)
        }
    }

    private fun drawPrimitiveLine(
        canvas: Canvas,
        primitive: SnapshotSymbolPrimitive,
        bounds: SnapshotBounds,
        device: SnapshotDevice,
        palette: RenderPalette,
        alpha: Int,
    ) {
        if (primitive.points.size < 4) {
            return
        }
        applyPaintColor(strokePaint, resolvePaint(primitive.stroke ?: "stroke", device, palette), alpha)
        strokePaint.strokeWidth = primitive.strokeWidth ?: 2.2f
        strokePaint.pathEffect = primitive.dash?.takeIf { it.size >= 2 }?.let {
            DashPathEffect(it.toFloatArray(), 0f)
        }

        path.reset()
        path.moveTo(bounds.x + primitive.points[0], bounds.y + primitive.points[1])
        var index = 2
        while (index + 1 < primitive.points.size) {
            path.lineTo(bounds.x + primitive.points[index], bounds.y + primitive.points[index + 1])
            index += 2
        }
        if (primitive.closed == true) {
            path.close()
            primitive.fill?.let {
                applyPaintColor(fillPaint, resolvePaint(it, device, palette), alpha)
                canvas.drawPath(path, fillPaint)
            }
        }
        canvas.drawPath(path, strokePaint)
        strokePaint.pathEffect = null
    }

    private fun drawPrimitiveRect(
        canvas: Canvas,
        primitive: SnapshotSymbolPrimitive,
        bounds: SnapshotBounds,
        device: SnapshotDevice,
        palette: RenderPalette,
        alpha: Int,
    ) {
        val x = primitive.x ?: return
        val y = primitive.y ?: return
        val width = primitive.width ?: return
        val height = primitive.height ?: return
        rect.set(bounds.x + x, bounds.y + y, bounds.x + x + width, bounds.y + y + height)
        primitive.fill?.let {
            applyPaintColor(fillPaint, resolvePaint(it, device, palette), alpha)
            canvas.drawRoundRect(rect, primitive.radius ?: 0f, primitive.radius ?: 0f, fillPaint)
        }
        primitive.stroke?.let {
            applyPaintColor(strokePaint, resolvePaint(it, device, palette), alpha)
            strokePaint.strokeWidth = primitive.strokeWidth ?: 2.2f
            canvas.drawRoundRect(rect, primitive.radius ?: 0f, primitive.radius ?: 0f, strokePaint)
        }
    }

    private fun drawPrimitiveCircle(
        canvas: Canvas,
        primitive: SnapshotSymbolPrimitive,
        bounds: SnapshotBounds,
        device: SnapshotDevice,
        palette: RenderPalette,
        alpha: Int,
    ) {
        val x = primitive.x ?: return
        val y = primitive.y ?: return
        val radius = primitive.radius ?: return
        primitive.fill?.let {
            applyPaintColor(fillPaint, resolvePaint(it, device, palette), alpha)
            canvas.drawCircle(bounds.x + x, bounds.y + y, radius, fillPaint)
        }
        primitive.stroke?.let {
            applyPaintColor(strokePaint, resolvePaint(it, device, palette), alpha)
            strokePaint.strokeWidth = primitive.strokeWidth ?: 2.2f
            canvas.drawCircle(bounds.x + x, bounds.y + y, radius, strokePaint)
        }
    }

    private fun drawPrimitiveText(
        canvas: Canvas,
        primitive: SnapshotSymbolPrimitive,
        bounds: SnapshotBounds,
        device: SnapshotDevice,
        palette: RenderPalette,
        alpha: Int,
    ) {
        val x = primitive.x ?: return
        val y = primitive.y ?: return
        val value = primitive.text ?: return
        applyPaintColor(textPaint, resolvePaint(primitive.fill ?: "accent", device, palette), alpha)
        textPaint.textSize = primitive.fontSize ?: 14f
        textPaint.textAlign = Paint.Align.LEFT
        canvas.drawText(value, bounds.x + x, bounds.y + y + textPaint.textSize, textPaint)
        textPaint.textAlign = Paint.Align.CENTER
    }

    private fun resolvePaint(value: String, device: SnapshotDevice, palette: RenderPalette): Int {
        return when (value) {
            "stroke" -> palette.deviceStroke
            "accent" -> parseColorOrFallback(device.symbolAccent, palette.deviceSelected)
            else -> parseColorOrFallback(value, palette.deviceStroke)
        }
    }

    private fun applyPaintColor(paint: Paint, color: Int, alpha: Int) {
        paint.color = color
        paint.alpha = (Color.alpha(color) * alpha / 255f).toInt().coerceIn(0, 255)
    }

    private fun drawBody(
        canvas: Canvas,
        device: SnapshotDevice,
        palette: RenderPalette,
        scale: Float,
        selected: Boolean,
        alpha: Int,
    ) {
        val bounds = device.bounds
        fillPaint.color = palette.deviceFill
        fillPaint.alpha = alpha
        strokePaint.color = if (selected) palette.deviceSelected else palette.deviceStroke
        strokePaint.strokeWidth = if (selected) 3.5f / scale else 2f / scale
        strokePaint.alpha = alpha
        rect.set(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)

        when (device.shape) {
            "circle" -> {
                canvas.drawOval(rect, fillPaint)
                canvas.drawOval(rect, strokePaint)
            }
            "triangle" -> {
                path.reset()
                path.moveTo(bounds.x + bounds.width / 2f, bounds.y)
                path.lineTo(bounds.x + bounds.width, bounds.y + bounds.height)
                path.lineTo(bounds.x, bounds.y + bounds.height)
                path.close()
                canvas.drawPath(path, fillPaint)
                canvas.drawPath(path, strokePaint)
            }
            else -> {
                canvas.drawRoundRect(rect, 8f, 8f, fillPaint)
                canvas.drawRoundRect(rect, 8f, 8f, strokePaint)
            }
        }
    }

    private fun drawDedicatedSymbol(
        canvas: Canvas,
        device: SnapshotDevice,
        palette: RenderPalette,
        scale: Float,
        alpha: Int,
    ) {
        strokePaint.color = palette.deviceStroke
        strokePaint.strokeWidth = 2.4f / scale
        strokePaint.alpha = alpha
        textPaint.color = palette.textSecondary
        textPaint.textSize = 14f / scale
        textPaint.alpha = alpha

        when (device.visualKind) {
            "resistor", "ferrite-bead" -> drawResistor(canvas, device.bounds)
            "capacitor" -> drawCapacitor(canvas, device.bounds, electrolytic = false)
            "electrolytic-capacitor" -> drawCapacitor(canvas, device.bounds, electrolytic = true)
            "inductor" -> drawInductor(canvas, device.bounds)
            "diode", "flyback-diode", "rectifier-diode", "zener-diode", "tvs-diode" -> {
                drawDiode(canvas, device.bounds, device.visualKind)
            }
            "led" -> {
                drawDiode(canvas, device.bounds, device.visualKind)
                drawLedArrows(canvas, device.bounds)
            }
            "op-amp" -> drawOpAmpMarks(canvas, device.bounds)
            "nmos", "pmos" -> drawMosfet(canvas, device.bounds, device.visualKind == "pmos")
            "npn-transistor", "pnp-transistor" -> drawBjt(canvas, device.bounds, device.visualKind == "pnp-transistor")
            "switch", "push-button" -> drawSwitch(canvas, device.bounds, device.visualKind == "push-button")
            "crystal" -> drawCrystal(canvas, device.bounds)
            "connector" -> drawConnector(canvas, device.bounds)
        }
    }

    private fun drawResistor(canvas: Canvas, bounds: SnapshotBounds) {
        val cy = bounds.y + bounds.height * 0.62f
        val left = bounds.x + bounds.width * 0.18f
        val right = bounds.x + bounds.width * 0.82f
        val step = (right - left) / 8f
        canvas.drawLine(bounds.x + bounds.width * 0.08f, cy, left, cy, strokePaint)
        path.reset()
        path.moveTo(left, cy)
        for (index in 1..7) {
            val x = left + step * index
            val y = if (index % 2 == 0) cy + bounds.height * 0.12f else cy - bounds.height * 0.12f
            path.lineTo(x, y)
        }
        path.lineTo(right, cy)
        canvas.drawPath(path, strokePaint)
        canvas.drawLine(right, cy, bounds.x + bounds.width * 0.92f, cy, strokePaint)
    }

    private fun drawCapacitor(canvas: Canvas, bounds: SnapshotBounds, electrolytic: Boolean) {
        val cy = bounds.y + bounds.height * 0.62f
        val plateHeight = bounds.height * 0.34f
        val leftPlate = bounds.x + bounds.width * 0.45f
        val rightPlate = bounds.x + bounds.width * 0.55f
        canvas.drawLine(bounds.x + bounds.width * 0.16f, cy, leftPlate, cy, strokePaint)
        canvas.drawLine(rightPlate, cy, bounds.x + bounds.width * 0.84f, cy, strokePaint)
        canvas.drawLine(leftPlate, cy - plateHeight / 2f, leftPlate, cy + plateHeight / 2f, strokePaint)
        canvas.drawLine(rightPlate, cy - plateHeight / 2f, rightPlate, cy + plateHeight / 2f, strokePaint)
        if (electrolytic) {
            canvas.drawText("+", leftPlate - bounds.width * 0.12f, cy - plateHeight * 0.62f, textPaint)
        }
    }

    private fun drawInductor(canvas: Canvas, bounds: SnapshotBounds) {
        val cy = bounds.y + bounds.height * 0.62f
        val left = bounds.x + bounds.width * 0.24f
        val radius = min(bounds.width, bounds.height) * 0.11f
        canvas.drawLine(bounds.x + bounds.width * 0.1f, cy, left, cy, strokePaint)
        for (index in 0..3) {
            rect.set(
                left + radius * 2f * index,
                cy - radius,
                left + radius * 2f * (index + 1),
                cy + radius,
            )
            canvas.drawArc(rect, 180f, 180f, false, strokePaint)
        }
        canvas.drawLine(left + radius * 8f, cy, bounds.x + bounds.width * 0.9f, cy, strokePaint)
    }

    private fun drawDiode(canvas: Canvas, bounds: SnapshotBounds, visualKind: String) {
        val cy = bounds.y + bounds.height * 0.62f
        val left = bounds.x + bounds.width * 0.22f
        val right = bounds.x + bounds.width * 0.78f
        val center = bounds.x + bounds.width * 0.5f
        val top = cy - bounds.height * 0.16f
        val bottom = cy + bounds.height * 0.16f
        canvas.drawLine(bounds.x + bounds.width * 0.1f, cy, left, cy, strokePaint)
        canvas.drawLine(right, cy, bounds.x + bounds.width * 0.9f, cy, strokePaint)
        path.reset()
        path.moveTo(left, top)
        path.lineTo(left, bottom)
        path.lineTo(center, cy)
        path.close()
        canvas.drawPath(path, strokePaint)
        canvas.drawLine(right, top, right, bottom, strokePaint)
        if (visualKind == "zener-diode" || visualKind == "tvs-diode") {
            canvas.drawLine(right, top, right + bounds.width * 0.04f, top - bounds.height * 0.05f, strokePaint)
            canvas.drawLine(right, bottom, right - bounds.width * 0.04f, bottom + bounds.height * 0.05f, strokePaint)
        }
    }

    private fun drawLedArrows(canvas: Canvas, bounds: SnapshotBounds) {
        val startX = bounds.x + bounds.width * 0.62f
        val startY = bounds.y + bounds.height * 0.34f
        for (index in 0..1) {
            val x = startX + index * bounds.width * 0.08f
            val y = startY - index * bounds.height * 0.08f
            canvas.drawLine(x, y, x + bounds.width * 0.12f, y - bounds.height * 0.12f, strokePaint)
            canvas.drawLine(x + bounds.width * 0.12f, y - bounds.height * 0.12f, x + bounds.width * 0.08f, y - bounds.height * 0.02f, strokePaint)
            canvas.drawLine(x + bounds.width * 0.12f, y - bounds.height * 0.12f, x + bounds.width * 0.02f, y - bounds.height * 0.08f, strokePaint)
        }
    }

    private fun drawOpAmpMarks(canvas: Canvas, bounds: SnapshotBounds) {
        canvas.drawText("+", bounds.x + bounds.width * 0.33f, bounds.y + bounds.height * 0.45f, textPaint)
        canvas.drawText("-", bounds.x + bounds.width * 0.33f, bounds.y + bounds.height * 0.66f, textPaint)
    }

    private fun drawMosfet(canvas: Canvas, bounds: SnapshotBounds, pmos: Boolean) {
        val cx = bounds.x + bounds.width * 0.52f
        val top = bounds.y + bounds.height * 0.38f
        val bottom = bounds.y + bounds.height * 0.78f
        val gateX = bounds.x + bounds.width * 0.32f
        canvas.drawLine(cx, top, cx, bottom, strokePaint)
        canvas.drawLine(cx, top, bounds.x + bounds.width * 0.75f, top, strokePaint)
        canvas.drawLine(cx, bottom, bounds.x + bounds.width * 0.75f, bottom, strokePaint)
        canvas.drawLine(gateX, top, gateX, bottom, strokePaint)
        canvas.drawLine(bounds.x + bounds.width * 0.16f, (top + bottom) / 2f, gateX, (top + bottom) / 2f, strokePaint)
        val arrowY = if (pmos) top + (bottom - top) * 0.35f else top + (bottom - top) * 0.65f
        val arrowDir = if (pmos) -1f else 1f
        canvas.drawLine(cx, arrowY, cx + bounds.width * 0.12f * arrowDir, arrowY, strokePaint)
    }

    private fun drawBjt(canvas: Canvas, bounds: SnapshotBounds, pnp: Boolean) {
        val baseX = bounds.x + bounds.width * 0.44f
        val centerY = bounds.y + bounds.height * 0.58f
        canvas.drawLine(baseX, bounds.y + bounds.height * 0.35f, baseX, bounds.y + bounds.height * 0.8f, strokePaint)
        canvas.drawLine(baseX, centerY, bounds.x + bounds.width * 0.18f, centerY, strokePaint)
        canvas.drawLine(baseX, bounds.y + bounds.height * 0.45f, bounds.x + bounds.width * 0.78f, bounds.y + bounds.height * 0.32f, strokePaint)
        canvas.drawLine(baseX, bounds.y + bounds.height * 0.7f, bounds.x + bounds.width * 0.78f, bounds.y + bounds.height * 0.84f, strokePaint)
        val arrowStartX = if (pnp) bounds.x + bounds.width * 0.72f else bounds.x + bounds.width * 0.56f
        val arrowEndX = if (pnp) bounds.x + bounds.width * 0.56f else bounds.x + bounds.width * 0.72f
        canvas.drawLine(arrowStartX, bounds.y + bounds.height * 0.79f, arrowEndX, bounds.y + bounds.height * 0.72f, strokePaint)
    }

    private fun drawSwitch(canvas: Canvas, bounds: SnapshotBounds, pushButton: Boolean) {
        val cy = bounds.y + bounds.height * 0.62f
        val left = bounds.x + bounds.width * 0.28f
        val right = bounds.x + bounds.width * 0.72f
        canvas.drawCircle(left, cy, bounds.height * 0.035f, strokePaint)
        canvas.drawCircle(right, cy, bounds.height * 0.035f, strokePaint)
        if (pushButton) {
            canvas.drawLine(left + bounds.width * 0.05f, cy - bounds.height * 0.18f, right - bounds.width * 0.05f, cy - bounds.height * 0.18f, strokePaint)
        }
        canvas.drawLine(left + bounds.width * 0.03f, cy, right - bounds.width * 0.06f, cy - bounds.height * 0.2f, strokePaint)
    }

    private fun drawCrystal(canvas: Canvas, bounds: SnapshotBounds) {
        val cy = bounds.y + bounds.height * 0.62f
        val leftPlate = bounds.x + bounds.width * 0.36f
        val rightPlate = bounds.x + bounds.width * 0.64f
        canvas.drawLine(bounds.x + bounds.width * 0.14f, cy, leftPlate, cy, strokePaint)
        canvas.drawLine(rightPlate, cy, bounds.x + bounds.width * 0.86f, cy, strokePaint)
        canvas.drawLine(leftPlate, cy - bounds.height * 0.2f, leftPlate, cy + bounds.height * 0.2f, strokePaint)
        canvas.drawLine(rightPlate, cy - bounds.height * 0.2f, rightPlate, cy + bounds.height * 0.2f, strokePaint)
        rect.set(bounds.x + bounds.width * 0.42f, cy - bounds.height * 0.14f, bounds.x + bounds.width * 0.58f, cy + bounds.height * 0.14f)
        canvas.drawRect(rect, strokePaint)
    }

    private fun drawConnector(canvas: Canvas, bounds: SnapshotBounds) {
        val startX = bounds.x + bounds.width * 0.36f
        val step = bounds.height * 0.16f
        val startY = bounds.y + bounds.height * 0.36f
        for (index in 0..3) {
            canvas.drawCircle(startX, startY + step * index, bounds.height * 0.025f, strokePaint)
            canvas.drawLine(startX + bounds.width * 0.08f, startY + step * index, bounds.x + bounds.width * 0.72f, startY + step * index, strokePaint)
        }
    }

    private fun resetAlpha() {
        fillPaint.alpha = 255
        strokePaint.alpha = 255
        textPaint.alpha = 255
    }
}
