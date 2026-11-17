import { MapView } from '../map/MapView';
import { AircraftCard } from './AircraftCard';
import { AircraftList } from './AircraftList';
import { CommandBar } from './CommandBar';
import { EventLog } from './EventLog';
import { IncidentList } from './IncidentList';
import { LayerPanel } from './LayerPanel';
import type { View } from './popout';

function MapStage() {
  return (
    <div className="stage">
      <MapView />
      <LayerPanel />
      <AircraftCard />
    </div>
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
            <aside className="rail">
              <IncidentList />
              <AircraftList />
            </aside>
          </main>
          <EventLog strip />
        </>
      )}
      {view === 'map' && (
        <main className="solo">
          <MapStage />
        </main>
      )}
      {view === 'air' && (
        <main className="solo column">
          <AircraftList />
        </main>
      )}
      {view === 'alerts' && (
        <main className="solo column">
          <IncidentList />
          <EventLog />
        </main>
      )}
    </div>
  );
}
