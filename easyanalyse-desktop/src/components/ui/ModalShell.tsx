import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export interface ModalShellProps {
  children: ReactNode
  rootClassName: string
  panelClassName: string
  onClose?: () => void
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  backdropClassName?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  closeDisabled?: boolean
  trapFocus?: boolean
  initialFocusSelector?: string
  panelTabIndex?: number
}

export function ModalShell({
  children,
  rootClassName,
  panelClassName,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  backdropClassName,
  closeOnBackdrop = true,
  closeOnEscape = false,
  closeDisabled = false,
  trapFocus = false,
  initialFocusSelector,
  panelTabIndex,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const handlesKeyDown = closeOnEscape || trapFocus
  const resolvedPanelTabIndex = panelTabIndex ?? (trapFocus || initialFocusSelector ? -1 : undefined)

  useEffect(() => {
    if (!initialFocusSelector) return
    panelRef.current?.querySelector<HTMLElement>(initialFocusSelector)?.focus()
  }, [initialFocusSelector])

  const requestClose = () => {
    if (!closeDisabled) {
      onClose?.()
    }
  }

  const handleRootClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && closeOnBackdrop) {
      requestClose()
    }
  }

  const handleBackdropClick = () => {
    if (closeOnBackdrop) {
      requestClose()
    }
  }

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape' && closeOnEscape) {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab' || !trapFocus) {
      return
    }

    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return (
    <div
      className={rootClassName}
      onClick={handleRootClick}
      onKeyDownCapture={handlesKeyDown ? handleKeyDownCapture : undefined}
    >
      {backdropClassName ? <div className={backdropClassName} aria-hidden="true" onClick={handleBackdropClick} /> : null}
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={resolvedPanelTabIndex}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
