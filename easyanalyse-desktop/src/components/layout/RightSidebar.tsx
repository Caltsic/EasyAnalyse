import { useState } from 'react'
import { Inspector } from '../Inspector'
import { AgentPanel } from '../agent/AgentPanel'
import { BlueprintsPanel } from '../blueprints/BlueprintsPanel'

type RightSidebarTab = 'inspector' | 'blueprints' | 'agent'

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('inspector')

  return (
    <aside className="right-sidebar" aria-label="Right sidebar">
      <div className="right-sidebar__tabs" role="tablist" aria-label="Right sidebar panels">
        <button
          id="right-sidebar-inspector-tab"
          className={activeTab === 'inspector' ? 'right-sidebar__tab is-active' : 'right-sidebar__tab'}
          role="tab"
          type="button"
          aria-selected={activeTab === 'inspector'}
          aria-controls="right-sidebar-inspector"
          onClick={() => setActiveTab('inspector')}
        >
          Inspector
        </button>
        <button
          id="right-sidebar-blueprints-tab"
          className={activeTab === 'blueprints' ? 'right-sidebar__tab is-active' : 'right-sidebar__tab'}
          role="tab"
          type="button"
          aria-selected={activeTab === 'blueprints'}
          aria-controls="right-sidebar-blueprints"
          onClick={() => setActiveTab('blueprints')}
        >
          Blueprints
        </button>
        <button
          id="right-sidebar-agent-tab"
          className={activeTab === 'agent' ? 'right-sidebar__tab is-active' : 'right-sidebar__tab'}
          role="tab"
          type="button"
          aria-selected={activeTab === 'agent'}
          aria-controls="right-sidebar-agent"
          onClick={() => setActiveTab('agent')}
        >
          Agent
        </button>
      </div>

      <div className="right-sidebar__panel">
        {activeTab === 'inspector' ? (
          <div
            id="right-sidebar-inspector"
            role="tabpanel"
            aria-labelledby="right-sidebar-inspector-tab"
            className="right-sidebar__tabpanel"
          >
            <Inspector />
          </div>
        ) : null}
        {activeTab === 'blueprints' ? (
          <div
            id="right-sidebar-blueprints"
            role="tabpanel"
            aria-labelledby="right-sidebar-blueprints-tab"
            className="right-sidebar__tabpanel"
          >
            <BlueprintsPanel />
          </div>
        ) : null}
        {activeTab === 'agent' ? (
          <div
            id="right-sidebar-agent"
            role="tabpanel"
            aria-labelledby="right-sidebar-agent-tab"
            className="right-sidebar__tabpanel"
          >
            <AgentPanel />
          </div>
        ) : null}
      </div>
    </aside>
  )
}
