import type { ThemeMode } from './theme'

export interface CanvasTheme {
  background: string
  gridMinor: string
  gridMajor: string
  gridAxis: string
  focusOverlay: string
  focusOverlayOpacity: number
  deviceStroke: string
  deviceText: string
  deviceMutedText: string
  symbolStroke: string
  referenceText: string
  labelLeader: string
  labelFallback: string
  labelFocused: string
  highlightFill: string
  highlightStroke: string
  glassLine: string
  glassFillStrong: string
  glassFillSoft: string
  glassFillNone: string
  terminalEmphasis: string
  shadowNeutral: string
  shadowFocus: string
  shadowUpstream: string
  shadowDownstream: string
  shadowConnection: string
  deviceSurface: {
    normalTop: string
    normalFill: string
    normalBottom: string
    focusTop: string
    focusFill: string
    focusBottom: string
    labelTop: string
    labelFill: string
    labelBottom: string
    upstreamTop: string
    upstreamFill: string
    upstreamBottom: string
    downstreamTop: string
    downstreamFill: string
    downstreamBottom: string
    connectionTop: string
    connectionFill: string
    connectionBottom: string
  }
}

export function getCanvasTheme(theme: ThemeMode): CanvasTheme {
  if (theme === 'dark') {
    return {
      background: '#111416',
      gridMinor: 'rgba(88, 99, 109, ',
      gridMajor: 'rgba(128, 142, 155, ',
      gridAxis: 'rgba(177, 189, 200, ',
      focusOverlay: '#0d1012',
      focusOverlayOpacity: 0.42,
      deviceStroke: '#4a565f',
      deviceText: '#f4f7f8',
      deviceMutedText: 'rgba(202, 212, 219, 0.84)',
      symbolStroke: '#edf4f6',
      referenceText: 'rgba(205, 216, 223, 0.92)',
      labelLeader: 'rgba(190, 202, 211, 0.42)',
      labelFallback: '#7db7ff',
      labelFocused: '#8bc5ff',
      highlightFill: 'rgba(94, 169, 255, 0.18)',
      highlightStroke: 'rgba(126, 190, 255, 0.94)',
      glassLine: 'rgba(255,255,255,0.18)',
      glassFillStrong: 'rgba(255,255,255,0.16)',
      glassFillSoft: 'rgba(255,255,255,0.07)',
      glassFillNone: 'rgba(255,255,255,0)',
      terminalEmphasis: '#f5f7f8',
      shadowNeutral: 'rgba(0, 0, 0, 0.38)',
      shadowFocus: 'rgba(83, 160, 255, 0.26)',
      shadowUpstream: 'rgba(248, 113, 113, 0.18)',
      shadowDownstream: 'rgba(74, 222, 128, 0.18)',
      shadowConnection: 'rgba(94, 169, 255, 0.2)',
      deviceSurface: {
        normalTop: '#2b3136',
        normalFill: '#22282d',
        normalBottom: '#171c20',
        focusTop: '#23374b',
        focusFill: '#193047',
        focusBottom: '#111f31',
        labelTop: '#263a50',
        labelFill: '#1a3149',
        labelBottom: '#132235',
        upstreamTop: '#452728',
        upstreamFill: '#362022',
        upstreamBottom: '#271618',
        downstreamTop: '#213b2c',
        downstreamFill: '#1a2f24',
        downstreamBottom: '#122219',
        connectionTop: '#24384e',
        connectionFill: '#1a3148',
        connectionBottom: '#122439',
      },
    }
  }

  return {
    background: '#ffffff',
    gridMinor: 'rgba(203, 213, 225, ',
    gridMajor: 'rgba(148, 163, 184, ',
    gridAxis: 'rgba(148, 163, 184, ',
    focusOverlay: '#ffffff',
    focusOverlayOpacity: 0.52,
    deviceStroke: '#d0d5dd',
    deviceText: '#0f172a',
    deviceMutedText: 'rgba(15, 23, 42, 0.78)',
    symbolStroke: '#0F172A',
    referenceText: 'rgba(71, 85, 105, 0.92)',
    labelLeader: 'rgba(71, 85, 105, 0.42)',
    labelFallback: '#2563eb',
    labelFocused: '#1d4ed8',
    highlightFill: 'rgba(37, 99, 235, 0.14)',
    highlightStroke: 'rgba(37, 99, 235, 0.92)',
    glassLine: 'rgba(255,255,255,0.62)',
    glassFillStrong: 'rgba(255,255,255,0.68)',
    glassFillSoft: 'rgba(255,255,255,0.18)',
    glassFillNone: 'rgba(255,255,255,0)',
    terminalEmphasis: '#111827',
    shadowNeutral: 'rgba(15, 23, 42, 0.16)',
    shadowFocus: 'rgba(37, 99, 235, 0.24)',
    shadowUpstream: 'rgba(185, 28, 28, 0.16)',
    shadowDownstream: 'rgba(21, 128, 61, 0.16)',
    shadowConnection: 'rgba(37, 99, 235, 0.18)',
    deviceSurface: {
      normalTop: '#f6f9fc',
      normalFill: '#e7edf5',
      normalBottom: '#d6dee9',
      focusTop: '#f8fbff',
      focusFill: '#eaf2ff',
      focusBottom: '#d8e5fb',
      labelTop: '#f4f8ff',
      labelFill: '#eaf2ff',
      labelBottom: '#dce9ff',
      upstreamTop: '#fff7f7',
      upstreamFill: '#fde8e8',
      upstreamBottom: '#f7cfd1',
      downstreamTop: '#f4fff6',
      downstreamFill: '#e4f5e8',
      downstreamBottom: '#cfe6d6',
      connectionTop: '#f3f8ff',
      connectionFill: '#e3eeff',
      connectionBottom: '#cfdfff',
    },
  }
}
