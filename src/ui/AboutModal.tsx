import { WEB_APP_URL } from '../lib/comms';
import { APP, APP_UPPER, SUITE } from '../lib/brand';
import { setState } from '../data/store';
import { embedUrl } from '../lib/embed';
import { isWeb } from '../lib/http';
import { DESKTOP_APP, GITHUB_URL, MOBILE_APP, WEB_GITHUB_URL } from '../lib/links';
import { Modal, Qr } from './Modals';
import appIcon from '../../assets/brand/vigilance-icon.svg?url';

function AppLink({ url, label, note }: { url: string; label: string; note: string }) {
  return (
    <div className="get-app">
      <Qr text={url} caption={label.split(' (')[0]} size={148} />
      <div>
        <b>{label}</b>
        <p className="muted small-text">{note}</p>
        <a className="btn small" href={url} target="_blank" rel="noopener noreferrer">
          Open {new URL(url).host}
        </a>
        <div className="mono small-text muted url">{url}</div>
      </div>
    </div>
  );
}

/** Web deployments can show a ready-made embed snippet for their own address. */
function EmbedSnippet() {
  const base = new URL(import.meta.env.BASE_URL, location.href).href;
  const tag = `<script src="${base}embed.js" data-city="denver" data-view="dashboard" async></script>`;
  return (
    <section>
      <h3>Put it on your website</h3>
      <p className="muted small-text">Paste this where the console should appear. It adds a responsive frame. Options: data-view (dashboard, map), data-city (denver, atlanta or lat,lon), data-theme, data-height.</p>
      <pre className="cmd">{tag}</pre>
      <p className="muted small-text">
        Or link straight to <a href={embedUrl(base, { view: 'map', city: 'atlanta' })} target="_blank" rel="noopener noreferrer">the embed page</a>.
      </p>
    </section>
  );
}

export function AboutModal() {
  return (
    <Modal title="Get the app">
      <section>
        <div className="about-brand">
          <img src={appIcon} alt="" width={56} height={56} />
          <span className="about-names">
            <b>{APP_UPPER}</b>
            <small>Part of the {SUITE}</small>
          </span>
        </div>
        <p className="small-text">
          <b>{APP}</b> is an open-source situational-awareness console for asset protection, executive protection, patrol and neighborhood watch. It uses public, keyless data
          sources and never tracks or identifies individuals.
        </p>
        <p className="small-text">
          The <b>{SUITE}</b> is three apps that work together on the same teams: <b>Vigilance</b> for the desktop (Mac, Windows, Linux), <b>Vigilante</b> on the web and as the Field Agent phone app, and <b>Vigil</b> for Android.
        </p>
        <AppLink url={WEB_APP_URL} label="Vigilante web app (opens on any phone or computer)" note="Scan with a phone camera to open the live web app. On a phone it opens Vigilante Field Agent: area scan, live map, push-to-talk, team chat. Nothing to install." />
        <AppLink url={DESKTOP_APP.url} label={DESKTOP_APP.label} note="Source code, desktop installers and docs. The desktop app adds drone Remote ID scanning, Meshtastic radios, multi-monitor pop-outs and keys kept off the web." />
        <AppLink url={MOBILE_APP.url} label={MOBILE_APP.label} note="Scan with your phone. Until the Play Store listing is live this links to the project page." />
        <AppLink url={WEB_GITHUB_URL} label="Vigilante web app source on GitHub" note="The code behind r0n1n9.github.io/vigilante." />
      </section>
      {isWeb() && <EmbedSnippet />}
      <div className="modal-foot">
        <a className="btn" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <button className="btn primary" onClick={() => setState({ modal: null })}>
          Done
        </button>
      </div>
    </Modal>
  );
}
