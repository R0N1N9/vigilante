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
import { POPOUT_VIEWS, type View } from './ui/popout';

const param = new URLSearchParams(location.search).get('view');
const view: View = POPOUT_VIEWS.some((v) => v.view === param) || param === 'areas' ? (param as View) : 'console';
const isLeader = view === 'console';

startBus(isLeader);
if (isLeader) void startEngine();

createRoot(document.getElementById('root')!).render(<App view={view} />);
