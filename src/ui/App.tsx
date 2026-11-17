import { setState, useStore, type RailTab } from '../data/store';
import { MapView } from '../map/MapView';
import { AircraftCard } from './AircraftCard';
import { AircraftList } from './AircraftList';
import { AlertsTab } from './AlertsTab';
import { AreasTab, DrawBar } from './AreasTab';
import { CamerasTab, CameraViewer } from './Cameras';
import { CommandBar } from './CommandBar';
import { DronesTab } from './DronesTab';
import { EventLog } from './EventLog';
import { LayerPanel } from './LayerPanel';
import { Modals } from './Modals';
import { NewsTab } from './NewsTab';
import type { View } from './popout';
import { TrafficTab } from './TrafficTab';

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
  { id: 'news', label: 'News' },
  { id: 'traffic', label: 'Roads' },
  { id: 'cameras', label: 'Cams' },
  { id: 'air', label: 'Air' },
  { id: 'drones', label: 'Drones' },
  { id: 'areas', label: 'Areas' },
];

function Badge({ tab }: { tab: RailTab }) {
  const n = useStore((s) =>
    tab === 'alerts' ? s.incidents.length + s.clusters.length : tab === 'traffic' ? s.traffic.filter((t) => t.severity >= 2).length : tab === 'drones' ? s.drones.length : tab === 'news' ? s.news.filter((x) => x.severity >= 2 && x.local).length : 0,
  );
  return n ? <span className="badge">{n}</span> : null;
}

function TabBody({ tab }: { tab: RailTab }) {
  switch (tab) {
    case 'alerts':
      return <AlertsTab />;
    case 'news':
      return <NewsTab />;
    case 'traffic':
      return <TrafficTab />;
    case 'cameras':
      return <CamerasTab />;
    case 'air':
      return <AircraftList />;
    case 'drones':
      return <DronesTab />;
    case 'areas':
      return <AreasTab />;
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
        <TabBody tab={tab} />
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
  return (
    <div className={`app view-${view}`}>
      <CommandBar view={view} />
      {view === 'console' && (
        <>
          <main className="console">
            <MapStage />
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
      {view === 'air' && <Solo title="AIRCRAFT"><AircraftList /></Solo>}
      {view === 'news' && <Solo title="NEWS & LIVE TV"><NewsTab /></Solo>}
      {view === 'traffic' && <Solo title="ROADS"><TrafficTab /></Solo>}
      {view === 'cameras' && <Solo title="CAMERA WALL"><CamerasTab wall={6} /></Solo>}
      {view === 'drones' && <Solo title="DRONES"><DronesTab /></Solo>}
      {view === 'areas' && <Solo title="WATCH AREAS"><AreasTab /></Solo>}
      <Modals />
    </div>
  );
}
