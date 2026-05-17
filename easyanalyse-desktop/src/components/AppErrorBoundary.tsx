import { Component, type ErrorInfo, type ReactNode } from 'react'

type ResetKey = string | number | null | undefined

interface AppErrorFallbackProps {
  title: string
  description: string
  error: unknown
  compact?: boolean
  componentStack?: string | null
  onReset?: () => void
  onReload?: () => void
  detailsLabel?: string
  tryAgainLabel?: string
  reloadLabel?: string
}

interface AppErrorBoundaryProps {
  children: ReactNode
  title?: string
  description?: string
  compact?: boolean
  resetKey?: ResetKey
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  detailsLabel?: string
  tryAgainLabel?: string
  reloadLabel?: string
}

interface AppErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function AppErrorFallback({
  title,
  description,
  error,
  compact = false,
  componentStack,
  onReset,
  onReload,
  detailsLabel = 'Error details',
  tryAgainLabel = 'Try again',
  reloadLabel = 'Reload',
}: AppErrorFallbackProps) {
  const message = getErrorText(error)
  const stack = error instanceof Error ? error.stack : null

  return (
    <section
      className={`app-error-boundary${compact ? ' app-error-boundary--compact' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="app-error-boundary__content">
        <h2>{title}</h2>
        <p>{description}</p>
        {message && <pre className="app-error-boundary__message">{message}</pre>}
        {(stack || componentStack) && (
          <details className="app-error-boundary__details">
            <summary>{detailsLabel}</summary>
            {stack && <pre>{stack}</pre>}
            {componentStack && <pre>{componentStack}</pre>}
          </details>
        )}
        <div className="app-error-boundary__actions">
          {onReset && (
            <button type="button" onClick={onReset}>
              {tryAgainLabel}
            </button>
          )}
          {onReload && (
            <button className="ghost-button" type="button" onClick={onReload}>
              {reloadLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? null })
    this.props.onError?.(error, errorInfo)
    console.error('EasyAnalyse UI error', error, errorInfo)
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: null })
    }
  }

  private reset = () => {
    this.setState({ error: null, componentStack: null })
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <AppErrorFallback
          title={this.props.title ?? 'EasyAnalyse UI error'}
          description={
            this.props.description ??
            'A view failed to render. The document is still on disk; retry or reload the app.'
          }
          error={this.state.error}
          compact={this.props.compact}
          componentStack={this.state.componentStack}
          onReset={this.reset}
          onReload={this.props.compact ? undefined : this.reload}
          detailsLabel={this.props.detailsLabel}
          tryAgainLabel={this.props.tryAgainLabel}
          reloadLabel={this.props.reloadLabel}
        />
      )
    }

    return this.props.children
  }
}
