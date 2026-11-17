import { useState } from 'react';
import { useStore } from '../data/store';
import { AircraftList } from './AircraftList';
import { DronesTab } from './DronesTab';

export function SkyTab() {
  const drones = useStore((s) => s.drones.length);
  const [section, setSection] = useState<'air' | 'drones'>('air');
  return (
    <>
      <div className="subtabs seg small">
        <button className={section === 'air' ? 'on' : ''} onClick={() => setSection('air')}>
          Aircraft
        </button>
        <button className={section === 'drones' ? 'on' : ''} onClick={() => setSection('drones')}>
          Drones{drones ? ` · ${drones}` : ''}
        </button>
      </div>
      {section === 'air' ? <AircraftList /> : <DronesTab />}
    </>
  );
}
