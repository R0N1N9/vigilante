/**
 * Deploy field agents: one big QR code a teammate scans with their phone camera to open the
 * Vigilance Field Agent web app already joined to the team (iPhone or Android, nothing to install),
 * plus the Vigil Android app and a plain link to the web app. Creates a team channel if there isn't one.
 */
import { APP } from '../lib/brand';
import { useMemo, useState } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { fieldLink, newNtfyChannel, vigilLink, WEB_APP_URL, type NtfyChannel } from '../lib/comms';
import { MOBILE_APP } from '../lib/links';
import { getPack } from '../lib/packs';
import { Icon } from './Icon';
import { Modal, Qr } from './Modals';
import { openSystem } from './popout';

export const openDeploy = () => setState({ modal: 'deploy' });

export function DeployModal() {
  const all = useStore((s) => s.channels);
  const chans = useMemo(() => all.filter((c): c is NtfyChannel => c.kind === 'ntfy' && c.enabled && !!c.posKey), [all]);
  const callsign = useStore((s) => s.settings.team.callsign);
  const [pick, setPick] = useState('');
  const [copied, setCopied] = useState('');
  const ch = chans.find((c) => c.id === pick) ?? chans[0];
  const plain = `${WEB_APP_URL}?view=field`;
  const copy = async (what: string, label: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      prompt('Copy this:', what);
    }
  };
  const create = () => {
    const c = newNtfyChannel({ name: `${getPack(getState().packId).name} team` });
    setShared({ channels: [...getState().channels, c] });
    setPick(c.id);
  };
  if (!ch)
    return (
      <Modal title="Deploy field agents" wide>
        <section className="deploy">
          <p>Field agents join with a team channel: an encrypted channel for chat, locations, marks, photos and push-to-talk. Create one and the QR code appears here.</p>
          <button className="btn primary" onClick={create}>
            <Icon name="users" />
            Create a team channel
          </button>
          <div className="deploy-alt">
            <Qr text={plain} caption="Field Agent web app (they create or join a team there)" size={160} />
          </div>
        </section>
      </Modal>
    );
  const link = fieldLink(ch);
  const who = callsign ? `${callsign} is deploying you` : "You're being deployed";
  const msg = `${who} as a field agent on "${ch.name}".\n\nOpen this on your phone (iPhone or Android, nothing to install): ${link}\n\nAndroid app instead? Get Vigil (${MOBILE_APP.url}), then open: ${vigilLink(ch)}\n\nThis link works like a key: please don't forward it.`;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <Modal title="Deploy field agents" wide>
      <section className="deploy">
        {chans.length > 1 && (
          <label className="field">
            <span>Team channel</span>
            <select value={ch.id} onChange={(e) => setPick(e.target.value)}>
              {chans.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="deploy-main">
          <Qr text={link} caption={`Field Agent · ${ch.name}`} size={260} />
          <div>
            <h3>Scan with a phone camera</h3>
            <ol>
              <li>Opens the <b>{APP} Field Agent</b> web app, already joined to <b>{ch.name}</b>. Works on iPhone and Android, nothing to install.</li>
              <li>They enter a callsign and tap <b>Start sharing</b>; they show up on your map and in Agents.</li>
              <li>Now, Map, Radio and Team tabs: area scan, live map with the hold ring, push-to-talk, marks, photos and chat.</li>
              <li>
                <b>Add to Home Screen</b> keeps it like an app (Safari → Share on iPhone, browser menu on Android).
              </li>
            </ol>
            <div className="copy-row">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="btn small" onClick={() => void copy(link, 'link')}>
                {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="field-row">
              <button className="btn small" onClick={() => void copy(msg, 'msg')}>
                {copied === 'msg' ? 'Copied' : 'Copy message'}
              </button>
              <button className="btn small" onClick={() => void openSystem(`sms:?&body=${encodeURIComponent(msg)}`)}>
                Text
              </button>
              <button className="btn small" onClick={() => void openSystem(`mailto:?subject=${encodeURIComponent(`Join ${ch.name} as a field agent`)}&body=${encodeURIComponent(msg)}`)}>
                Email
              </button>
              {canShare && (
                <button className="btn small" onClick={() => void navigator.share({ title: `Join ${ch.name}`, text: msg }).catch(() => {})}>
                  Share…
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="deploy-alt">
          <Qr text={MOBILE_APP.url} caption="Android: get the Vigil app" size={130} />
          <Qr text={vigilLink(ch)} caption="Then scan this in Vigil" size={130} />
          <Qr text={plain} caption="Just the web app (no team yet)" size={130} />
        </div>
        <p className="muted small-text">
          Anyone with the team code can join and read the team's traffic. Show it only to your people; if it leaks, make a new channel.{' '}
          <button className="link" onClick={() => setState({ modal: 'invite', inviteChannelId: ch.id })}>
            More invite options (laptops, ntfy app)
          </button>
        </p>
      </section>
    </Modal>
  );
}
