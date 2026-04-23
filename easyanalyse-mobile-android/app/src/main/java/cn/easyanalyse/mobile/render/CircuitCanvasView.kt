package cn.easyanalyse.mobile.render

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.animation.DecelerateInterpolator
import cn.easyanalyse.mobile.model.MobileRenderSnapshot
import cn.easyanalyse.mobile.model.SnapshotBounds
import cn.easyanalyse.mobile.model.SnapshotDevice
import cn.easyanalyse.mobile.model.SnapshotNetworkLine
import cn.easyanalyse.mobile.model.SnapshotPoint
import cn.easyanalyse.mobile.model.SnapshotTerminal
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

class CircuitCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    var onSelectionChanged: ((CircuitSelection?) -> Unit)? = null

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
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.NORMAL)
    }
    private val boldTextPaint = Paint(textPaint).apply {
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
    }
    private val symbolRenderer = DeviceSymbolRenderer()

    private var snapshot: MobileRenderSnapshot? = null
    private var palette: RenderPalette = lightRenderPalette()
    private var selection: CircuitSelection? = null
    private var focusedDeviceId: String? = null
    private var focusState = FocusState.empty()
    private var focusProgress = 0f
    private var needsFit = true
    private var viewportAnimator: ValueAnimator? = null
    private var focusAnimator: ValueAnimator? = null

    private var scale = 1f
    private var offsetX = 0f
    private var offsetY = 0f
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var movedDuringGesture = false
    private var suppressSingleFingerDrag = false

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                cancelViewportAnimation()
                movedDuringGesture = true
                suppressSingleFingerDrag = true
                return true
            }

            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val oldScale = scale
                val nextScale = (scale * detector.scaleFactor).coerceIn(MIN_SCALE, MAX_SCALE)
                if (abs(nextScale - oldScale) <= 0.0001f) {
                    return true
                }

                val focusX = detector.focusX
                val focusY = detector.focusY
                val worldX = screenToWorldX(focusX)
                val worldY = screenToWorldY(focusY)
                scale = nextScale
                offsetX = focusX - worldX * scale
                offsetY = focusY - worldY * scale
                movedDuringGesture = true
                invalidate()
                return true
            }

            override fun onScaleEnd(detector: ScaleGestureDetector) {
                suppressSingleFingerDrag = true
            }
        },
    )

    fun setSnapshot(nextSnapshot: MobileRenderSnapshot?) {
        if (snapshot === nextSnapshot) {
            return
        }
        cancelViewportAnimation()
        cancelFocusAnimation()
        snapshot = nextSnapshot
        selection = null
        focusedDeviceId = null
        focusState = FocusState.empty()
        focusProgress = 0f
        needsFit = true
        requestLayout()
        invalidate()
    }

    fun setRenderPalette(nextPalette: RenderPalette) {
        palette = nextPalette
        invalidate()
    }

    fun setSelection(nextSelection: CircuitSelection?) {
        selection = nextSelection
        invalidate()
    }

    fun setFocusedDeviceId(deviceId: String?) {
        if (focusedDeviceId == deviceId) {
            return
        }
        cancelFocusAnimation()
        focusedDeviceId = deviceId
        focusState = buildFocusState(snapshot, deviceId)
        focusProgress = if (focusState.active) 1f else 0f
        invalidate()
    }

    fun focusOnDevice(deviceId: String) {
        val current = snapshot ?: return
        focusedDeviceId = deviceId
        focusState = buildFocusState(snapshot, deviceId)
        animateFocusProgress(target = 1f, durationMillis = FOCUS_FADE_IN_MS)
        animateViewportToBounds(
            computeFocusBounds(current, focusState) ?: current.canvas.worldBounds,
            durationMillis = FOCUS_VIEWPORT_MS,
        )
        invalidate()
    }

    fun clearDeviceFocus() {
        val current = snapshot
        val hadFocus = focusState.active || focusedDeviceId != null || focusProgress > 0.001f
        focusedDeviceId = null
        if (current != null) {
            animateViewportToBounds(current.canvas.worldBounds, durationMillis = OVERVIEW_VIEWPORT_MS)
        }
        if (hadFocus) {
            animateFocusProgress(target = 0f, durationMillis = FOCUS_FADE_OUT_MS) {
                focusState = FocusState.empty()
                invalidate()
            }
        } else {
            focusState = FocusState.empty()
            focusProgress = 0f
            invalidate()
        }
    }

    fun fitToView() {
        val current = snapshot
        if (current == null || width <= 0 || height <= 0) {
            needsFit = true
            invalidate()
            return
        }
        needsFit = false
        animateViewportToBounds(current.canvas.worldBounds, durationMillis = OVERVIEW_VIEWPORT_MS)
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        needsFit = true
        fitSnapshotToView()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(palette.background)
        val current = snapshot ?: return
        if (needsFit) {
            fitSnapshotToView()
        }

        canvas.save()
        canvas.translate(offsetX, offsetY)
        canvas.scale(scale, scale)

        drawGrid(canvas, current)
        drawNetworkLines(canvas, current)
        drawDevices(canvas, current)
        drawTerminals(canvas, current)
        drawNetworkLabels(canvas, current)

        canvas.restore()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                cancelViewportAnimation()
                parent?.requestDisallowInterceptTouchEvent(true)
                lastTouchX = event.x
                lastTouchY = event.y
                movedDuringGesture = false
                suppressSingleFingerDrag = false
                return true
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                cancelViewportAnimation()
                movedDuringGesture = true
                suppressSingleFingerDrag = true
                resetDragAnchorToFirstPointer(event)
                return true
            }

            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount > 1 || scaleDetector.isInProgress) {
                    movedDuringGesture = true
                    suppressSingleFingerDrag = true
                    resetDragAnchorToFirstPointer(event)
                    return true
                }

                if (event.pointerCount == 1) {
                    if (suppressSingleFingerDrag) {
                        lastTouchX = event.x
                        lastTouchY = event.y
                        suppressSingleFingerDrag = false
                        return true
                    }

                    val dx = event.x - lastTouchX
                    val dy = event.y - lastTouchY
                    if (abs(dx) > 0.5f || abs(dy) > 0.5f) {
                        offsetX += dx
                        offsetY += dy
                        movedDuringGesture = true
                        invalidate()
                    }
                    lastTouchX = event.x
                    lastTouchY = event.y
                }
                return true
            }

            MotionEvent.ACTION_POINTER_UP -> {
                movedDuringGesture = true
                suppressSingleFingerDrag = true
                resetDragAnchorToRemainingPointer(event)
                return true
            }

            MotionEvent.ACTION_UP -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                if (!movedDuringGesture) {
                    val hit = hitTest(screenToWorldX(event.x), screenToWorldY(event.y))
                    selection = hit
                    onSelectionChanged?.invoke(hit)
                    invalidate()
                }
                suppressSingleFingerDrag = false
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                suppressSingleFingerDrag = false
                return true
            }
        }

        return true
    }

    override fun onDetachedFromWindow() {
        cancelViewportAnimation()
        cancelFocusAnimation()
        super.onDetachedFromWindow()
    }

    private fun resetDragAnchorToFirstPointer(event: MotionEvent) {
        if (event.pointerCount <= 0) {
            return
        }
        lastTouchX = event.getX(0)
        lastTouchY = event.getY(0)
    }

    private fun resetDragAnchorToRemainingPointer(event: MotionEvent) {
        if (event.pointerCount <= 1) {
            return
        }
        val liftedIndex = event.actionIndex
        val remainingIndex = if (liftedIndex == 0) 1 else 0
        lastTouchX = event.getX(remainingIndex)
        lastTouchY = event.getY(remainingIndex)
    }

    private fun fitSnapshotToView() {
        val current = snapshot ?: return
        if (width <= 0 || height <= 0) {
            return
        }

        fitBoundsToView(current.canvas.worldBounds)
        needsFit = false
    }

    private fun fitBoundsToView(bounds: SnapshotBounds?) {
        val transform = computeViewportTransform(bounds) ?: return
        applyViewportTransform(transform)
    }

    private fun computeViewportTransform(bounds: SnapshotBounds?): ViewportTransform? {
        if (bounds == null || width <= 0 || height <= 0) {
            return null
        }

        val horizontalPadding = 40f * resources.displayMetrics.density
        val topInset = 58f * resources.displayMetrics.density
        val rightInset = min(width * 0.32f, 300f * resources.displayMetrics.density)
        val availableWidth = max(1f, width - rightInset - horizontalPadding * 2f)
        val availableHeight = max(1f, height - topInset - horizontalPadding)
        val scaleX = availableWidth / max(bounds.width, 1f)
        val scaleY = availableHeight / max(bounds.height, 1f)
        val nextScale = min(scaleX, scaleY).coerceIn(MIN_SCALE, MAX_SCALE)
        return ViewportTransform(
            scale = nextScale,
            offsetX = horizontalPadding + availableWidth / 2f - (bounds.x + bounds.width / 2f) * nextScale,
            offsetY = topInset + availableHeight / 2f - (bounds.y + bounds.height / 2f) * nextScale,
        )
    }

    private fun animateViewportToBounds(bounds: SnapshotBounds?, durationMillis: Long) {
        val target = computeViewportTransform(bounds) ?: return
        val start = ViewportTransform(scale, offsetX, offsetY)
        cancelViewportAnimation()

        viewportAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMillis
            interpolator = DecelerateInterpolator(1.8f)
            addUpdateListener { animation ->
                val progress = animation.animatedValue as Float
                applyViewportTransform(
                    ViewportTransform(
                        scale = lerp(start.scale, target.scale, progress),
                        offsetX = lerp(start.offsetX, target.offsetX, progress),
                        offsetY = lerp(start.offsetY, target.offsetY, progress),
                    ),
                )
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                private var canceled = false

                override fun onAnimationCancel(animation: Animator) {
                    canceled = true
                }

                override fun onAnimationEnd(animation: Animator) {
                    if (viewportAnimator === animation) {
                        viewportAnimator = null
                    }
                    if (!canceled) {
                        applyViewportTransform(target)
                        invalidate()
                    }
                }
            })
            start()
        }
    }

    private fun animateFocusProgress(target: Float, durationMillis: Long, onComplete: (() -> Unit)? = null) {
        val start = focusProgress
        cancelFocusAnimation()
        if (abs(start - target) <= 0.001f) {
            focusProgress = target
            onComplete?.invoke()
            invalidate()
            return
        }

        focusAnimator = ValueAnimator.ofFloat(start, target).apply {
            duration = durationMillis
            interpolator = DecelerateInterpolator(1.8f)
            addUpdateListener { animation ->
                focusProgress = animation.animatedValue as Float
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                private var canceled = false

                override fun onAnimationCancel(animation: Animator) {
                    canceled = true
                }

                override fun onAnimationEnd(animation: Animator) {
                    if (focusAnimator === animation) {
                        focusAnimator = null
                    }
                    if (!canceled) {
                        focusProgress = target
                        onComplete?.invoke()
                        invalidate()
                    }
                }
            })
            start()
        }
    }

    private fun cancelViewportAnimation() {
        viewportAnimator?.cancel()
        viewportAnimator = null
    }

    private fun cancelFocusAnimation() {
        focusAnimator?.cancel()
        focusAnimator = null
    }

    private fun applyViewportTransform(transform: ViewportTransform) {
        scale = transform.scale
        offsetX = transform.offsetX
        offsetY = transform.offsetY
    }

    private fun lerp(start: Float, end: Float, progress: Float): Float {
        return start + (end - start) * progress
    }

    private fun drawGrid(canvas: Canvas, current: MobileRenderSnapshot) {
        val grid = current.canvas.grid ?: return
        if (!grid.enabled || grid.size <= 0f) {
            return
        }

        val left = screenToWorldX(0f)
        val top = screenToWorldY(0f)
        val right = screenToWorldX(width.toFloat())
        val bottom = screenToWorldY(height.toFloat())
        val step = grid.size
        val majorEvery = max(grid.majorEvery ?: 5, 1)
        val startX = floor(left / step).toInt() - 1
        val endX = ceil(right / step).toInt() + 1
        val startY = floor(top / step).toInt() - 1
        val endY = ceil(bottom / step).toInt() + 1

        strokePaint.strokeWidth = 1f / scale
        for (index in startX..endX) {
            strokePaint.color = if (index % majorEvery == 0) palette.gridMajor else palette.gridMinor
            val x = index * step
            canvas.drawLine(x, top, x, bottom, strokePaint)
        }
        for (index in startY..endY) {
            strokePaint.color = if (index % majorEvery == 0) palette.gridMajor else palette.gridMinor
            val y = index * step
            canvas.drawLine(left, y, right, y, strokePaint)
        }
    }

    private fun drawNetworkLines(canvas: Canvas, current: MobileRenderSnapshot) {
        for (line in current.networkLines) {
            val selected = selection is CircuitSelection.NetworkLine && (selection as CircuitSelection.NetworkLine).id == line.id
            val emphasized = isNetworkLineEmphasized(line)
            strokePaint.color = if (selected) palette.deviceSelected else palette.networkFallback
            strokePaint.strokeWidth = if (selected) 5f / scale else 3f / scale
            strokePaint.alpha = focusAlpha(emphasized, 48)
            canvas.drawLine(line.start.x, line.start.y, line.end.x, line.end.y, strokePaint)
        }
        strokePaint.alpha = 255
    }

    private fun drawDevices(canvas: Canvas, current: MobileRenderSnapshot) {
        for (device in current.devices) {
            val selected = selection is CircuitSelection.Device && (selection as CircuitSelection.Device).id == device.id
            val emphasized = isDeviceEmphasized(device)
            val alpha = focusAlpha(emphasized, 56)
            symbolRenderer.draw(canvas, device, palette, scale, selected, alpha)
            drawDeviceText(canvas, device, alpha)
        }
    }

    private fun drawDeviceText(canvas: Canvas, device: SnapshotDevice, alpha: Int) {
        val bounds = device.bounds
        val titleY = bounds.y + 28f
        boldTextPaint.color = palette.textPrimary
        boldTextPaint.alpha = alpha
        boldTextPaint.textSize = 14f / scale
        textPaint.color = palette.textSecondary
        textPaint.alpha = alpha
        textPaint.textSize = 12f / scale
        canvas.drawText(device.reference, bounds.x + 14f, titleY, boldTextPaint)
        if (scale >= 0.28f) {
            canvas.drawText(device.name.take(32), bounds.x + 14f, titleY + 20f / scale, textPaint)
        }
        boldTextPaint.alpha = 255
        textPaint.alpha = 255
    }

    private fun drawTerminals(canvas: Canvas, current: MobileRenderSnapshot) {
        val drawLabels = scale >= 0.42f
        for (device in current.devices) {
            for (terminal in device.terminals) {
                val emphasized = isTerminalEmphasized(terminal)
                val alpha = focusAlpha(emphasized, 48)
                val terminalColor = parseColorOrFallback(terminal.color.fill, palette.terminalFallback)
                fillPaint.color = terminalColor
                fillPaint.alpha = alpha
                strokePaint.color = palette.background
                strokePaint.strokeWidth = 1.5f / scale
                strokePaint.alpha = alpha
                canvas.drawCircle(terminal.point.x, terminal.point.y, 5.2f / scale, fillPaint)
                canvas.drawCircle(terminal.point.x, terminal.point.y, 5.2f / scale, strokePaint)

                if (drawLabels) {
                    textPaint.color = parseColorOrFallback(terminal.color.text, palette.textSecondary)
                    textPaint.alpha = alpha
                    textPaint.textSize = 11f / scale
                    val dx = when (terminal.side) {
                        "left" -> -8f / scale - textPaint.measureText(terminal.displayLabel)
                        "right" -> 8f / scale
                        else -> 6f / scale
                    }
                    val dy = when (terminal.side) {
                        "top" -> -8f / scale
                        "bottom" -> 18f / scale
                        else -> 4f / scale
                    }
                    canvas.drawText(terminal.displayLabel.take(28), terminal.point.x + dx, terminal.point.y + dy, textPaint)
                }
            }
        }
        fillPaint.alpha = 255
        strokePaint.alpha = 255
        textPaint.alpha = 255
    }

    private fun drawNetworkLabels(canvas: Canvas, current: MobileRenderSnapshot) {
        if (scale < 0.35f) {
            return
        }
        boldTextPaint.color = palette.textPrimary
        boldTextPaint.textSize = 12f / scale
        for (line in current.networkLines) {
            boldTextPaint.alpha = focusAlpha(isNetworkLineEmphasized(line), 48)
            canvas.drawText(line.label.take(32), line.position.x, line.position.y - 8f / scale, boldTextPaint)
        }
        boldTextPaint.alpha = 255
    }

    private fun hitTest(worldX: Float, worldY: Float): CircuitSelection? {
        val current = snapshot ?: return null
        for (device in current.devices.asReversed()) {
            if (contains(device.bounds, worldX, worldY)) {
                return CircuitSelection.Device(device.id)
            }
        }

        val tolerance = 18f / scale
        var nearest: SnapshotNetworkLine? = null
        var nearestDistance = Float.POSITIVE_INFINITY
        for (line in current.networkLines) {
            val distance = distanceToSegment(worldX, worldY, line.start, line.end)
            if (distance < tolerance && distance < nearestDistance) {
                nearest = line
                nearestDistance = distance
            }
        }
        return nearest?.let { CircuitSelection.NetworkLine(it.id) }
    }

    private fun screenToWorldX(screenX: Float) = (screenX - offsetX) / scale

    private fun screenToWorldY(screenY: Float) = (screenY - offsetY) / scale

    private fun contains(bounds: SnapshotBounds, x: Float, y: Float): Boolean {
        return x >= bounds.x &&
            x <= bounds.x + bounds.width &&
            y >= bounds.y &&
            y <= bounds.y + bounds.height
    }

    private fun distanceToSegment(x: Float, y: Float, start: SnapshotPoint, end: SnapshotPoint): Float {
        val dx = end.x - start.x
        val dy = end.y - start.y
        val lengthSquared = dx * dx + dy * dy
        if (lengthSquared <= 0.0001f) {
            return hypot(x - start.x, y - start.y)
        }
        val t = (((x - start.x) * dx + (y - start.y) * dy) / lengthSquared).coerceIn(0f, 1f)
        val closestX = start.x + dx * t
        val closestY = start.y + dy * t
        return hypot(x - closestX, y - closestY)
    }

    private fun isDeviceEmphasized(device: SnapshotDevice): Boolean {
        return !focusState.active || focusState.deviceIds.contains(device.id)
    }

    private fun isNetworkLineEmphasized(line: SnapshotNetworkLine): Boolean {
        return !focusState.active || focusState.connectionKeys.contains(line.labelKey)
    }

    private fun isTerminalEmphasized(terminal: SnapshotTerminal): Boolean {
        return !focusState.active ||
            focusState.terminalIds.contains(terminal.id) ||
            focusState.deviceIds.contains(terminal.deviceId)
    }

    private fun focusAlpha(emphasized: Boolean, dimAlpha: Int): Int {
        if (!focusState.active || emphasized) {
            return 255
        }
        return (255f + (dimAlpha - 255f) * focusProgress).toInt().coerceIn(dimAlpha, 255)
    }

    private fun buildFocusState(current: MobileRenderSnapshot?, deviceId: String?): FocusState {
        if (current == null || deviceId == null) {
            return FocusState.empty()
        }

        val relation = current.relations.firstOrNull { it.deviceId == deviceId }
        val deviceIds = linkedSetOf(deviceId)
        val connectionKeys = linkedSetOf<String>()
        val terminalIds = linkedSetOf<String>()

        if (relation != null) {
            deviceIds.addAll(relation.upstreamDeviceIds)
            deviceIds.addAll(relation.downstreamDeviceIds)
            connectionKeys.addAll(relation.connectionKeys)
            terminalIds.addAll(relation.relatedTerminalIds)
        }

        return FocusState(
            active = true,
            deviceIds = deviceIds,
            connectionKeys = connectionKeys,
            terminalIds = terminalIds,
        )
    }

    private fun computeFocusBounds(current: MobileRenderSnapshot?, state: FocusState): SnapshotBounds? {
        if (current == null || !state.active) {
            return null
        }

        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY

        fun includePoint(point: SnapshotPoint) {
            minX = min(minX, point.x)
            minY = min(minY, point.y)
            maxX = max(maxX, point.x)
            maxY = max(maxY, point.y)
        }

        fun includeBounds(bounds: SnapshotBounds) {
            includePoint(SnapshotPoint(bounds.x, bounds.y))
            includePoint(SnapshotPoint(bounds.x + bounds.width, bounds.y + bounds.height))
        }

        current.devices
            .filter { state.deviceIds.contains(it.id) }
            .forEach { includeBounds(it.bounds) }
        current.networkLines
            .filter { state.connectionKeys.contains(it.labelKey) }
            .forEach {
                includePoint(it.start)
                includePoint(it.end)
                includePoint(it.position)
            }

        if (!minX.isFinite() || !minY.isFinite() || !maxX.isFinite() || !maxY.isFinite()) {
            return current.devices.firstOrNull { it.id == state.deviceId }?.bounds
        }

        val padding = 120f
        return SnapshotBounds(
            x = minX - padding,
            y = minY - padding,
            width = max(280f, maxX - minX + padding * 2f),
            height = max(220f, maxY - minY + padding * 2f),
        )
    }

    private data class FocusState(
        val active: Boolean,
        val deviceIds: Set<String>,
        val connectionKeys: Set<String>,
        val terminalIds: Set<String>,
    ) {
        val deviceId: String?
            get() = deviceIds.firstOrNull()

        companion object {
            fun empty() = FocusState(
                active = false,
                deviceIds = emptySet(),
                connectionKeys = emptySet(),
                terminalIds = emptySet(),
            )
        }
    }

    private data class ViewportTransform(
        val scale: Float,
        val offsetX: Float,
        val offsetY: Float,
    )

    companion object {
        private const val MIN_SCALE = 0.12f
        private const val MAX_SCALE = 3.5f
        private const val FOCUS_VIEWPORT_MS = 380L
        private const val OVERVIEW_VIEWPORT_MS = 280L
        private const val FOCUS_FADE_IN_MS = 320L
        private const val FOCUS_FADE_OUT_MS = 280L
    }
}
