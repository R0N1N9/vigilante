import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { startBus } from './data/bus';
import { startEngine } from './data/engine';
import { App } from './ui/App';
import type { View } from './ui/popout';

const param = new URLSearchParams(location.search).get('view');
const view: View = param === 'map' || param === 'air' || param === 'alerts' ? param : 'console';
const isLeader = view === 'console';

startBus(isLeader);
if (isLeader) startEngine();

createRoot(document.getElementById('root')!).render(<App view={view} />);
