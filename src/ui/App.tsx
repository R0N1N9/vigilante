import { Component, useEffect, type ReactNode } from 'react';
import { applyAppearance } from '../lib/theme';
import { setState, useStore, type RailTab } from '../data/store';
import { MapView } from '../map/MapView';
import { AircraftCard } from './AircraftCard';
import { AlertsTab } from './AlertsTab';
import { AreasTab, DrawBar } from './AreasTab';
import { CamerasTab, CameraViewer } from './Cameras';
import { CommandBar } from './CommandBar';
import { RadioTab } from './RadioTab';
import { SkyTab } from './SkyTab';
import { HazardsTab } from './IntelPanels';
import { Dashboard } from './Dashboard';
import { EventLog } from './EventLog';
import { LayerPanel } from './LayerPanel';
import { Modals } from './Modals';
import { NewsTab } from './NewsTab';
import type { View } from './popout';
import { InfraTab } from './InfraTab';
import { TeamTab } from './TeamTab';
import { TeamView } from './Agents';

function MapStage() {
  return (
    <div className="stage">
      <MapView />
      <LayerPanel />
      <AircraftCard />
      <CameraViewer />
      <DrawBar />
    </div>
  );
}

const TABS: { id: RailTab; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'team', label: 'Team' },
  { id: 'news', label: 'News' },
  { id: 'radio', label: 'Radio' },
  { id: 'traffic', label: 'City' },
  { id: 'hazards', label: 'Hazards' },
  { id: 'cameras', label: 'Cams' },
  { id: 'sky', label: 'Sky' },
  { id: 'areas', label: 'Watch' },
];

function Badge({ tab }: { tab: RailTab }) {
  const n = useStore((s) =>
    tab === 'team' ? s.chat.filter((m) => !m.mine && m.at > s.teamSeenAt).length : tab === 'alerts' ? s.incidents.length + s.clusters.length + s.hits.filter((h) => !h.acked).length : tab === 'traffic' ? s.traffic.filter((t) => t.severity >= 2).length + s.transit.filter((t) => t.severity >= 2).length + s.outages.filter((o) => o.severity >= 1).length + s.fires.filter((f) => f.severity >= 1).length : tab === 'hazards' ? s.incidents.filter((i) => ['quake', 'flood', 'storm', 'air'].includes(i.kind)).length : tab === 'sky' ? s.drones.length : tab === 'news' ? s.news.filter((x) => x.severity >= 2 && x.local).length : 0,
  );
  return n ? <span className="badge">{n}</span> : null;
}

/** Keeps one broken panel from taking down the whole console. */
class PanelBoundary extends Component<{ children: ReactNode; name: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  componentDidUpdate(prev: { name: string }) {
    if (prev.name !== this.props.name && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="list">
          <div className="callout">
            <b>This panel hit an error.</b>
            <p className="mono small-text">{this.state.error}</p>
            <button className="btn small" onClick={() => this.setState({ error: null })}>
              Retry
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function TabBody({ tab }: { tab: RailTab }) {
  switch (tab) {
    case 'alerts':
      return <AlertsTab />;
    case 'news':
      return <NewsTab />;
    case 'traffic':
      return <InfraTab />;
    case 'cameras':
      return <CamerasTab />;
    case 'sky':
      return <SkyTab />;
    case 'radio':
      return <RadioTab />;
    case 'hazards':
      return <HazardsTab />;
    case 'areas':
      return <AreasTab />;
    case 'team':
      return <TeamTab />;
  }
}

function Rail() {
  const tab = useStore((s) => s.tab);
  return (
    <aside className="rail">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setState({ tab: t.id })}>
            {t.label}
            <Badge tab={t.id} />
          </button>
        ))}
      </nav>
      <div className="tab-body">
        <PanelBoundary name={tab}>
          <TabBody tab={tab} />
        </PanelBoundary>
      </div>
    </aside>
  );
}

function Solo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="solo column">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="tab-body">{children}</div>
    </main>
  );
}

export function App({ view }: { view: View }) {
  const mainView = useStore((s) => s.mainView);
  const appearance = useStore((s) => s.settings.appearance);
  useEffect(() => applyAppearance(appearance), [appearance]);
  return (
    <div className={`app view-${view}`}>
      <CommandBar view={view} />
      {view === 'console' && (
        <>
          <main className="console">
            {mainView === 'dashboard' ? <Dashboard /> : mainView === 'team' ? <TeamView map={<MapStage />} /> : <MapStage />}
            <Rail />
          </main>
          <EventLog strip />
        </>
      )}
      {view === 'map' && (
        <main className="solo">
          <MapStage />
        </main>
      )}
      {view === 'alerts' && (
        <main className="solo column">
          <div className="split">
            <div className="tab-body">
              <AlertsTab />
            </div>
            <EventLog />
          </div>
        </main>
      )}
      {view === 'dashboard' && (
        <main className="solo">
          <Dashboard />
        </main>
      )}
      {view === 'sky' && <Solo title="AIRCRAFT & DRONES"><SkyTab /></Solo>}
      {view === 'radio' && <Solo title="RADIO"><RadioTab /></Solo>}
      {view === 'news' && <Solo title="NEWS & LIVE TV"><NewsTab /></Solo>}
      {view === 'traffic' && <Solo title="ROADS · TRANSIT · POWER · FIRE"><InfraTab /></Solo>}
      {view === 'cameras' && <Solo title="CAMERA WALL"><CamerasTab wall={6} /></Solo>}
      {view === 'areas' && <Solo title="WATCH AREAS"><AreasTab /></Solo>}
      {view === 'team' && <Solo title="TEAM"><TeamTab /></Solo>}
      <Modals />
    </div>
  );
}
