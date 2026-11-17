import { useState } from 'react';
import { useStore } from '../data/store';
import { AircraftList } from './AircraftList';
import { DronesTab } from './DronesTab';
import { AirportStatus, ShipsList } from './IntelPanels';

export function SkyTab() {
  const drones = useStore((s) => s.drones.length);
  const [section, setSection] = useState<'air' | 'drones' | 'ships'>('air');
  const ships = useStore((s) => s.ships.length);
  return (
    <>
      <div className="subtabs seg small">
        <button className={section === 'air' ? 'on' : ''} onClick={() => setSection('air')}>
          Aircraft
        </button>
        <button className={section === 'drones' ? 'on' : ''} onClick={() => setSection('drones')}>
          Drones{drones ? ` · ${drones}` : ''}
        </button>
        <button className={section === 'ships' ? 'on' : ''} onClick={() => setSection('ships')}>
          Ships{ships ? ` · ${ships}` : ''}
        </button>
      </div>
      {section === 'air' && <AirportStatus />}
      {section === 'air' ? <AircraftList /> : section === 'drones' ? <DronesTab /> : <ShipsList />}
    </>
  );
}
