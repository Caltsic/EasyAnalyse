import type { ReactNode } from 'react'

export type StatusBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export interface StatusBadgeProps {
  tone?: StatusBadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function StatusBadge({ tone = 'neutral', icon, children, className }: StatusBadgeProps) {
  const classes = ['ui-status-badge', `ui-status-badge--${tone}`, className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      {icon}
      {children}
    </span>
  )
}
