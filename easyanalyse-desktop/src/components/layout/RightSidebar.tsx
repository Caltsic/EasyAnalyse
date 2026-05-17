import { useState } from 'react'
import { Bot, Boxes, MessageSquareText, SlidersHorizontal } from 'lucide-react'
import { translate, type TranslationKey } from '../../lib/i18n'
import { useEditorStore } from '../../store/editorStore'
import { Inspector } from '../Inspector'
import { AgentPanel } from '../agent/AgentPanel'
import { BlueprintsPanel } from '../blueprints/BlueprintsPanel'

type RightSidebarView = 'agent' | 'inspector' | 'blueprints'

const SIDEBAR_VIEWS: Array<{
  id: RightSidebarView
  labelKey: TranslationKey
  icon: typeof MessageSquareText
}> = [
  { id: 'agent', labelKey: 'chat', icon: MessageSquareText },
  { id: 'inspector', labelKey: 'inspector', icon: SlidersHorizontal },
  { id: 'blueprints', labelKey: 'blueprints', icon: Boxes },
]

export function RightSidebar() {
  const [activeView, setActiveView] = useState<RightSidebarView>('agent')
  const locale = useEditorStore((state) => state.locale)
  const t = (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params)
  const subtitle = activeView === 'agent' ? t('agentWorkspace') : activeView === 'inspector' ? t('inspectorView') : t('blueprintView')

  return (
    <aside className="right-sidebar" aria-label={t('rightSidebar')}>
      <header className="right-sidebar__header">
        <div className="right-sidebar__title">
          <span className="right-sidebar__brand-icon" aria-hidden="true">
            <Bot size={18} strokeWidth={2.1} />
          </span>
          <div>
            <h2>{t('aiChat')}</h2>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="right-sidebar__view-switch" role="tablist" aria-label={t('rightSidebar')}>
          {SIDEBAR_VIEWS.map((view) => {
            const Icon = view.icon
            const selected = activeView === view.id
            const label = t(view.labelKey)
            return (
              <button
                key={view.id}
                id={`right-sidebar-${view.id}-tab`}
                className={selected ? 'right-sidebar__view-button is-active' : 'right-sidebar__view-button'}
                role="tab"
                type="button"
                aria-label={label}
                title={label}
                aria-selected={selected}
                aria-controls={`right-sidebar-${view.id}`}
                onClick={() => setActiveView(view.id)}
              >
                <Icon size={16} strokeWidth={2.1} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </header>

      <div className="right-sidebar__panel">
        <div
          id="right-sidebar-inspector"
          role="tabpanel"
          aria-labelledby="right-sidebar-inspector-tab"
          className="right-sidebar__tabpanel"
          hidden={activeView !== 'inspector'}
          aria-hidden={activeView !== 'inspector'}
        >
          <Inspector />
        </div>
        <div
          id="right-sidebar-blueprints"
          role="tabpanel"
          aria-labelledby="right-sidebar-blueprints-tab"
          className="right-sidebar__tabpanel"
          hidden={activeView !== 'blueprints'}
          aria-hidden={activeView !== 'blueprints'}
        >
          <BlueprintsPanel />
        </div>
        <div
          id="right-sidebar-agent"
          role="tabpanel"
          aria-labelledby="right-sidebar-agent-tab"
          className="right-sidebar__tabpanel"
          hidden={activeView !== 'agent'}
          aria-hidden={activeView !== 'agent'}
        >
          <AgentPanel />
        </div>
      </div>
    </aside>
  )
}
