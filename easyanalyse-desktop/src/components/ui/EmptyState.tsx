import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title?: ReactNode
  children?: ReactNode
  className?: string
}

export function EmptyState({ title, children, className }: EmptyStateProps) {
  const classes = ['ui-empty-state', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {title ? <h3>{title}</h3> : null}
      {children ? <p>{children}</p> : null}
    </div>
  )
}
