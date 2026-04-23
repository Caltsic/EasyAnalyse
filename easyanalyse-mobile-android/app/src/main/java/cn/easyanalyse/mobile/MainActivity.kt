package cn.easyanalyse.mobile

import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import cn.easyanalyse.mobile.model.MobileRenderSnapshot
import cn.easyanalyse.mobile.model.SnapshotDevice
import cn.easyanalyse.mobile.model.SnapshotNetworkLine
import cn.easyanalyse.mobile.net.SnapshotRepository
import cn.easyanalyse.mobile.net.SnapshotUrlResolver
import cn.easyanalyse.mobile.render.CircuitCanvasView
import cn.easyanalyse.mobile.render.CircuitSelection
import cn.easyanalyse.mobile.render.darkRenderPalette
import cn.easyanalyse.mobile.render.lightRenderPalette
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

private val DetailsPanelWidth = 300.dp

class MainActivity : ComponentActivity() {
    private var deepLinkUrl by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        super.onCreate(savedInstanceState)
        deepLinkUrl = SnapshotUrlResolver.resolve(intent?.dataString)

        setContent {
            EasyAnalyseMobileApp(deepLinkUrl = deepLinkUrl)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLinkUrl = SnapshotUrlResolver.resolve(intent.dataString)
    }
}

@Composable
private fun EasyAnalyseMobileApp(deepLinkUrl: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repository = remember { SnapshotRepository() }
    var inputUrl by remember { mutableStateOf(deepLinkUrl.orEmpty()) }
    var snapshot by remember { mutableStateOf<MobileRenderSnapshot?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var darkTheme by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf<CircuitSelection?>(null) }
    var focusedDeviceId by remember { mutableStateOf<String?>(null) }

    fun loadSnapshot(rawUrl: String?) {
        val snapshotUrl = SnapshotUrlResolver.resolve(rawUrl)
        if (snapshotUrl.isNullOrBlank()) {
            error = "无法识别二维码或链接。"
            return
        }

        inputUrl = snapshotUrl
        loading = true
        error = null
        scope.launch {
            runCatching { repository.fetch(snapshotUrl) }
                .onSuccess {
                    snapshot = it
                    selection = null
                    focusedDeviceId = null
                }
                .onFailure { throwable ->
                    error = throwable.message ?: "加载失败。"
                }
            loading = false
        }
    }

    LaunchedEffect(deepLinkUrl) {
        if (!deepLinkUrl.isNullOrBlank()) {
            loadSnapshot(deepLinkUrl)
        }
    }

    MaterialTheme(
        colorScheme = if (darkTheme) {
            darkColorScheme(
                background = Color(0xFF111416),
                surface = Color(0xFF191E22),
                primary = Color(0xFF60A5FA),
            )
        } else {
            lightColorScheme(
                background = Color(0xFFFFFFFF),
                surface = Color(0xFFF8FAFC),
                primary = Color(0xFF2563EB),
            )
        },
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = if (darkTheme) Color(0xFF111416) else Color(0xFFFFFFFF),
        ) {
            if (snapshot == null) {
                StartScreen(
                    inputUrl = inputUrl,
                    loading = loading,
                    error = error,
                    darkTheme = darkTheme,
                    onInputUrlChange = { inputUrl = it },
                    onToggleTheme = { darkTheme = !darkTheme },
                    onOpen = { loadSnapshot(inputUrl) },
                    onScan = {
                        val options = GmsBarcodeScannerOptions.Builder()
                            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                            .build()
                        GmsBarcodeScanning.getClient(context, options)
                            .startScan()
                            .addOnSuccessListener { barcode ->
                                loadSnapshot(barcode.rawValue)
                            }
                            .addOnFailureListener { throwable ->
                                error = throwable.message ?: "扫码失败。"
                            }
                    },
                )
            } else {
                ViewerScreen(
                    snapshot = snapshot!!,
                    selection = selection,
                    focusedDeviceId = focusedDeviceId,
                    darkTheme = darkTheme,
                    onSelectionChange = { selection = it },
                    onFocusDevice = { id ->
                        focusedDeviceId = id
                        selection = CircuitSelection.Device(id)
                    },
                    onClearFocus = { focusedDeviceId = null },
                    onToggleTheme = { darkTheme = !darkTheme },
                    onFitRequest = { view -> view.fitToView() },
                    onClose = {
                        snapshot = null
                        selection = null
                        focusedDeviceId = null
                    },
                )
            }
        }
    }
}

@Composable
private fun StartScreen(
    inputUrl: String,
    loading: Boolean,
    error: String?,
    darkTheme: Boolean,
    onInputUrlChange: (String) -> Unit,
    onToggleTheme: () -> Unit,
    onOpen: () -> Unit,
    onScan: () -> Unit,
) {
    val foreground = if (darkTheme) Color(0xFFEEF6F9) else Color(0xFF0F172A)
    val secondary = if (darkTheme) Color(0xFFA6B7BF) else Color(0xFF475569)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(if (darkTheme) Color(0xFF111416) else Color(0xFFFFFFFF))
            .padding(28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("EASYAnalyse 手机查看器", color = foreground, style = MaterialTheme.typography.headlineMedium)
        Text("横屏只读查看。扫码后直接拉取 Windows 端快照。", color = secondary)
        Spacer(modifier = Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onScan, enabled = !loading) {
                Text("扫码")
            }
            Button(onClick = onOpen, enabled = !loading) {
                Text(if (loading) "加载中" else "打开链接")
            }
            Text("夜间", color = secondary)
            Switch(checked = darkTheme, onCheckedChange = { onToggleTheme() })
        }
        OutlinedTextField(
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            value = inputUrl,
            onValueChange = onInputUrlChange,
            label = { Text("快照链接或 easyanalyse:// 链接") },
            singleLine = true,
        )
        if (!error.isNullOrBlank()) {
            Text(error, color = Color(0xFFDC2626), modifier = Modifier.padding(top = 12.dp))
        }
    }
}

@Composable
private fun ViewerScreen(
    snapshot: MobileRenderSnapshot,
    selection: CircuitSelection?,
    focusedDeviceId: String?,
    darkTheme: Boolean,
    onSelectionChange: (CircuitSelection?) -> Unit,
    onFocusDevice: (String) -> Unit,
    onClearFocus: () -> Unit,
    onToggleTheme: () -> Unit,
    onFitRequest: (CircuitCanvasView) -> Unit,
    onClose: () -> Unit,
) {
    val palette = if (darkTheme) darkRenderPalette() else lightRenderPalette()
    var canvasView by remember { mutableStateOf<CircuitCanvasView?>(null) }

    fun clearFocus() {
        canvasView?.clearDeviceFocus()
        onClearFocus()
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                CircuitCanvasView(context).also { view ->
                    canvasView = view
                    view.onSelectionChanged = onSelectionChange
                    view.setSnapshot(snapshot)
                    view.setFocusedDeviceId(focusedDeviceId)
                    view.setRenderPalette(palette)
                }
            },
            update = { view ->
                canvasView = view
                view.onSelectionChanged = onSelectionChange
                view.setSnapshot(snapshot)
                view.setSelection(selection)
                view.setFocusedDeviceId(focusedDeviceId)
                view.setRenderPalette(palette)
            },
        )

        TopOverlay(
            title = snapshot.document.title,
            focusedTitle = snapshot.devices.firstOrNull { it.id == focusedDeviceId }?.title,
            darkTheme = darkTheme,
            onToggleTheme = onToggleTheme,
            onClearFocus = { clearFocus() },
            onFit = { canvasView?.let(onFitRequest) },
            onClose = onClose,
        )

        SelectionPanel(
            modifier = Modifier.align(Alignment.CenterEnd),
            snapshot = snapshot,
            selection = selection,
            focusedDeviceId = focusedDeviceId,
            darkTheme = darkTheme,
            onFocusDevice = { id ->
                onFocusDevice(id)
                canvasView?.focusOnDevice(id)
            },
            onClearFocus = { clearFocus() },
        )
    }
}

@Composable
private fun TopOverlay(
    title: String,
    focusedTitle: String?,
    darkTheme: Boolean,
    onToggleTheme: () -> Unit,
    onClearFocus: () -> Unit,
    onFit: () -> Unit,
    onClose: () -> Unit,
) {
    val background = if (darkTheme) Color(0xDD191E22) else Color(0xDDF8FAFC)
    val foreground = if (darkTheme) Color(0xFFEEF6F9) else Color(0xFF0F172A)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = DetailsPanelWidth)
            .background(background)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (focusedTitle.isNullOrBlank()) title else "$title / 聚焦: $focusedTitle",
            color = foreground,
            modifier = Modifier.weight(1f),
            maxLines = 1,
        )
        if (!focusedTitle.isNullOrBlank()) {
            TextButton(onClick = onClearFocus) { Text("退出聚焦") }
        }
        TextButton(onClick = onFit) { Text("适配全图") }
        TextButton(onClick = onToggleTheme) { Text(if (darkTheme) "日间" else "夜间") }
        TextButton(onClick = onClose) { Text("返回") }
    }
}

@Composable
private fun SelectionPanel(
    modifier: Modifier,
    snapshot: MobileRenderSnapshot,
    selection: CircuitSelection?,
    focusedDeviceId: String?,
    darkTheme: Boolean,
    onFocusDevice: (String) -> Unit,
    onClearFocus: () -> Unit,
) {
    val background = if (darkTheme) Color(0xE6191E22) else Color(0xEFFFFFFF)
    val foreground = if (darkTheme) Color(0xFFEEF6F9) else Color(0xFF0F172A)
    val secondary = if (darkTheme) Color(0xFFA6B7BF) else Color(0xFF475569)
    val device = (selection as? CircuitSelection.Device)?.let { selected ->
        snapshot.devices.firstOrNull { it.id == selected.id }
    }
    val networkLine = (selection as? CircuitSelection.NetworkLine)?.let { selected ->
        snapshot.networkLines.firstOrNull { it.id == selected.id }
    }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(DetailsPanelWidth)
            .background(background)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("详情", color = foreground, style = MaterialTheme.typography.titleMedium)
        when {
            device != null -> DeviceDetails(
                device = device,
                focused = focusedDeviceId == device.id,
                foreground = foreground,
                secondary = secondary,
                onFocusDevice = onFocusDevice,
                onClearFocus = onClearFocus,
            )
            networkLine != null -> NetworkDetails(networkLine, snapshot, foreground, secondary)
            else -> Text("点击器件或网络线查看属性。", color = secondary)
        }
    }
}

@Composable
private fun DeviceDetails(
    device: SnapshotDevice,
    focused: Boolean,
    foreground: Color,
    secondary: Color,
    onFocusDevice: (String) -> Unit,
    onClearFocus: () -> Unit,
) {
    Text(device.title, color = foreground, style = MaterialTheme.typography.titleSmall)
    Text(device.kind, color = secondary)
    Button(onClick = { if (focused) onClearFocus() else onFocusDevice(device.id) }) {
        Text(if (focused) "退出聚焦" else "聚焦")
    }
    if (!device.description.isNullOrBlank()) {
        Text(device.description, color = secondary)
    }
    Text("端子 ${device.terminals.size}", color = foreground)
    device.terminals.take(8).forEach { terminal ->
        Text("${terminal.displayLabel}  ${terminal.direction}", color = secondary, maxLines = 1)
    }
    device.properties?.entries?.take(8)?.forEach { (key, value) ->
        Text("$key: ${value.toString().trim('"')}", color = secondary, maxLines = 1)
    }
}

@Composable
private fun NetworkDetails(
    networkLine: SnapshotNetworkLine,
    snapshot: MobileRenderSnapshot,
    foreground: Color,
    secondary: Color,
) {
    val group = snapshot.connectionGroups.firstOrNull { it.key == networkLine.labelKey }
    Text(networkLine.label, color = foreground, style = MaterialTheme.typography.titleSmall)
    Text(networkLine.orientation, color = secondary)
    if (group != null) {
        Text("关联器件 ${group.deviceIds.size}", color = foreground)
        group.deviceIds.take(10).forEach { id ->
            val device = snapshot.devices.firstOrNull { it.id == id }
            Text(device?.title ?: id, color = secondary, maxLines = 1)
        }
    }
}
