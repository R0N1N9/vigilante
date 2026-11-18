import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';

const param = new URLSearchParams(location.search).get('view');

// Phone check-in page: a light standalone view with no data engine. The console is a separate
// chunk, so a phone on mobile data downloads only the page it shows (no map engine, no feeds).
if (param === 'field') void import('./ui/FieldApp').then(({ mountFieldApp }) => mountFieldApp());
else void import('./console').then(({ boot }) => boot(param));
