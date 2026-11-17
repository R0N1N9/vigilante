import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { meshConnect, meshDisconnect, postToChannel } from '../data/engine/comms';
import { MESHTASTIC_APP_URL, newMeshChannel, newNtfyChannel, parseInvite, spotUrl, type ChatMessage, type MeshRadioSettings, type SharedSpot, type TeamChannel } from '../lib/comms';
import { MESH_TEXT_MAX } from '../lib/meshproto';
import { deviceLocation } from '../lib/locate';
import { isTauri } from '../lib/http';
import type { Severity } from '../lib/signals';
import { fmtTime } from './format';
import { getPack } from '../lib/packs';
import { openExternal } from './popout';
import { Icon, RichText } from './Icon';

const saveChannels = (channels: TeamChannel[]) => setShared({ channels });
const updateChannel = (id: string, patch: Partial<TeamChannel>) => saveChannels(getState().channels.map((c) => (c.id === id ? ({ ...c, ...patch } as TeamChannel) : c)));
const setTeamSettings = (patch: Partial<{ callsign: string }>) => {
  const s = getState().settings;
  setShared({ settings: { ...s, team: { ...s.team, ...patch } } });
};
const setRadio = (patch: Partial<MeshRadioSettings>) => {
  const s = getState().settings;
  setShared({ settings: { ...s, mesh: { ...s.mesh, ...patch } } });
};

/** Open the Team tab with a message ready to send (used by Share buttons around the app). */
export function shareToTeam(text: string, spot?: SharedSpot, url?: string) {
  setState({ teamDraft: { text, spot, url }, tab: 'team', mainView: getState().mainView });
}

function channelLive(ch: TeamChannel, meshState: string) {
  if (!ch.enabled) return 'off';
  if (ch.kind === 'mesh') return meshState === 'connected' ? 'live' : meshState === 'connecting' ? 'wait' : 'down';
  return 'live';
}

function Message({ m, channel, showChannel, tz }: { m: ChatMessage; channel?: TeamChannel; showChannel: boolean; tz: string }) {
  return (
    <div className={`msg ${m.mine ? 'mine' : ''} ${m.status ?? ''}`}>
      <div className="msg-meta">
        <b>{m.mine ? 'You' : m.from}</b>
        <span>{fmtTime(m.at, tz)}</span>
        {showChannel && channel && <span className={`msg-ch ${channel.kind}`}>{channel.kind === 'mesh' ? '◇' : '◆'} {channel.name}</span>}
        {m.mine && m.status === 'sending' && <span className="warn">sending…</span>}
        {m.mine && m.status === 'failed' && (
          <span className="crit" title={m.error}>
            failed{' '}
            <button className="link" onClick={() => setShared({ chat: getState().chat.map((x) => (x.id === m.id ? { ...x, status: 'sending', error: undefined } : x)) })}>
              retry
            </button>
          </span>
        )}
      </div>
      <div className="msg-text">
        <RichText text={m.text} />
      </div>
      {(m.spot || m.url) && (
        <div className="msg-card">
          {m.spot && (
            <button className="btn small" onClick={() => setShared({ focus: { at: Date.now(), center: [m.spot!.lon, m.spot!.lat], zoom: 16, label: m.spot!.label ?? m.from } })}>
              <Icon name="target" />Show on map
            </button>
          )}
          {m.url && (
            <button className="btn small" onClick={() => void openExternal(m.url!, m.from)}>
              Open link ↗
            </button>
          )}
          {m.spot && <code>{`${m.spot.lat.toFixed(5)}, ${m.spot.lon.toFixed(5)}`}</code>}
        </div>
      )}
    </div>
  );
}

function Composer({ channels, active }: { channels: TeamChannel[]; active: string }) {
  const draft = useStore((s) => s.teamDraft);
  const focus = useStore((s) => s.focus);
  const enabled = channels.filter((c) => c.enabled);
  const [picked, setTarget] = useState(active !== 'all' ? active : '');
  // Fall back to the first enabled channel when nothing valid is picked (e.g. the first channel was just created).
  const target = enabled.some((c) => c.id === picked) ? picked : (enabled[0]?.id ?? '');
  const [text, setText] = useState('');
  const [spot, setSpot] = useState<SharedSpot | undefined>();
  const [url, setUrl] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (active !== 'all') setTarget(active);
  }, [active]);
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    setSpot(draft.spot);
    setUrl(draft.url);
    setState({ teamDraft: null });
  }, [draft]);
  const ch = channels.find((c) => c.id === target);
  const bytes = new TextEncoder().encode(text).length + (spot ? 22 : 0);
  const tooLong = ch?.kind === 'mesh' && bytes > MESH_TEXT_MAX;
  const send = () => {
    if (!ch || (!text.trim() && !spot)) return;
    postToChannel(ch.id, text.trim() || (spot?.label ? `📍 ${spot.label}` : '📍 Location'), { spot, url });
    setText('');
    setSpot(undefined);
    setUrl(undefined);
  };
  if (!enabled.length) return null;
  return (
    <div className="composer">
      {(spot || url) && (
        <div className="attach">
          {spot && (
            <span>
              <Icon name="pin" size={12} /> {spot.label ?? `${spot.lat.toFixed(4)}, ${spot.lon.toFixed(4)}`}
            </span>
          )}
          {url && <span className="url">↗ {url.replace(/^https?:\/\//, '').slice(0, 40)}</span>}
          <button
            className="x"
            onClick={() => {
              setSpot(undefined);
              setUrl(undefined);
            }}
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      )}
      <div className="composer-row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Send to channel">
          {enabled.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kind === 'mesh' ? '◇' : '◆'} {c.name}
            </option>
          ))}
        </select>
        <button className="btn small" title="Attach the spot last selected on the map or dashboard" disabled={!focus} onClick={() => focus && setSpot({ lat: focus.center[1], lon: focus.center[0], label: focus.label })}>
          <Icon name="target" />Spot
        </button>
        <button
          className="btn small"
          title="Attach this computer's location"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const at = await deviceLocation();
              setSpot({ lat: at[1], lon: at[0], label: `${getState().settings.team.callsign || 'My'} position` });
            } catch {
              alert('Location is unavailable on this computer.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '…' : <><Icon name="pin" />Me</>}
        </button>
      </div>
      <div className="composer-row">
        <textarea
          rows={2}
          value={text}
          placeholder={ch?.kind === 'mesh' ? 'Message the mesh (short, ~200 characters)' : 'Message the team'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!tooLong) send();
            }
          }}
        />
        <button className="btn send" disabled={!ch || tooLong || (!text.trim() && !spot)} onClick={send}>
          Send
        </button>
      </div>
      {ch?.kind === 'mesh' && <div className={`counter ${tooLong ? 'crit' : ''}`}>{bytes}/{MESH_TEXT_MAX} bytes{tooLong ? ' · too long for the radio' : ''}</div>}
    </div>
  );
}

function RadioPanel() {
  const r = useStore((s) => s.settings.mesh);
  const st = useStore((s) => s.meshStatus);
  const [ports, setPorts] = useState<{ path: string; label: string }[]>([]);
  const desktop = isTauri();
  const listPorts = async () => {
    try {
      setPorts(await invoke<{ path: string; label: string }[]>('mesh_serial_ports'));
    } catch (e) {
      alert(String(e));
    }
  };
  return (
    <div className="radio-panel">
      <div className="radio-head">
        <b>Meshtastic radio</b>
        <span className={`dot ${st.state}`} />
        <span className="mono small-text">
          {st.state === 'connected' ? `${st.node ?? 'connected'} · ${st.detail}` : st.state === 'connecting' ? 'connecting…' : st.state === 'error' ? st.detail : 'not connected'}
        </span>
      </div>
      {!desktop && <p className="muted small-text">Connecting a radio needs the desktop app (Bluetooth / USB / local Wi-Fi).</p>}
      <div className="field-row">
        <label className="field">
          <span>Connect by</span>
          <select value={r.transport} onChange={(e) => setRadio({ transport: e.target.value as MeshRadioSettings['transport'], address: '' })}>
            <option value="ble">Bluetooth</option>
            <option value="serial">USB cable</option>
            <option value="http">Wi-Fi (same network)</option>
          </select>
        </label>
        <label className="field grow">
          <span>{r.transport === 'ble' ? 'Radio name (blank = first found)' : r.transport === 'serial' ? 'Serial port' : 'Radio address'}</span>
          <input value={r.address} onChange={(e) => setRadio({ address: e.target.value.trim() })} placeholder={r.transport === 'ble' ? 'Meshtastic_1a2b' : r.transport === 'serial' ? '/dev/ttyUSB0 or COM3' : 'meshtastic.local or 192.168.1.50'} list={r.transport === 'serial' ? 'mesh-ports' : undefined} />
          <datalist id="mesh-ports">
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </datalist>
        </label>
        {r.transport === 'serial' && desktop && (
          <button className="btn small" onClick={() => void listPorts()}>
            Find ports
          </button>
        )}
      </div>
      <div className="field-row">
        {st.state === 'connected' || st.state === 'connecting' ? (
          <button className="btn small" onClick={() => void meshDisconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="btn small primary" disabled={!desktop} onClick={() => void meshConnect()}>
            Connect radio
          </button>
        )}
        <label className="check small-text">
          <input type="checkbox" checked={r.autoConnect} onChange={() => setRadio({ autoConnect: !r.autoConnect })} /> Connect when the app starts
        </label>
      </div>
      {st.radioChannels && st.radioChannels.length > 0 && <p className="muted small-text">Channels on this radio: {st.radioChannels.map((c) => `${c.index}: ${c.name}`).join(' · ')}</p>}
      <p className="muted small-text">
        No radio yet? Any Meshtastic device works (Heltec, LilyGO T-Beam/T-Echo, RAK WisBlock, SenseCAP T1000-E). Set it up with the{' '}
        <button className="link" onClick={() => void openExternal(MESHTASTIC_APP_URL, 'Meshtastic')}>
          Meshtastic app
        </button>
        , then connect it here. Messages are encrypted with the channel key on the radio.
      </p>
    </div>
  );
}

function ChannelRow({ ch }: { ch: TeamChannel }) {
  const [open, setOpen] = useState(false);
  const meshState = useStore((s) => s.meshStatus.state);
  const radioChannels = useStore((s) => s.meshStatus.radioChannels);
  const u = (patch: Partial<TeamChannel>) => updateChannel(ch.id, patch);
  return (
    <article className={`ch-row ${ch.enabled ? '' : 'off'}`}>
      <div className="ch-head">
        <label className="switch" title={ch.enabled ? 'On' : 'Off'}>
          <input type="checkbox" checked={ch.enabled} onChange={() => u({ enabled: !ch.enabled })} />
          <i />
        </label>
        <span className={`dot ${channelLive(ch, meshState)}`} />
        <button className="mon-title" onClick={() => setOpen(!open)}>
          <b>{ch.name}</b>
          <small>{ch.kind === 'ntfy' ? `NTFY · ${ch.server.replace(/^https:\/\//, '')}/${ch.topic}` : `MESHTASTIC · CHANNEL ${ch.channelIndex}`}</small>
        </button>
        <button className="btn small" onClick={() => setState({ modal: 'invite', inviteChannelId: ch.id })}>
          Invite
        </button>
        <button className="x" title="Remove channel" onClick={() => confirm(`Remove "${ch.name}"? Messages stay in history.`) && saveChannels(getState().channels.filter((c) => c.id !== ch.id))}>
          ×
        </button>
      </div>
      {open && (
        <div className="mon-editor">
          <label className="field">
            <span>Name</span>
            <input value={ch.name} onChange={(e) => u({ name: e.target.value })} />
          </label>
          {ch.kind === 'ntfy' ? (
            <>
              <div className="field-row">
                <label className="field">
                  <span>Server</span>
                  <input value={ch.server} onChange={(e) => u({ server: e.target.value.trim() })} />
                </label>
                <label className="field">
                  <span>Topic</span>
                  <input value={ch.topic} onChange={(e) => u({ topic: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} />
                </label>
              </div>
              <label className="field">
                <span>Access token (optional, for a protected topic on your own server)</span>
                <input type="password" value={ch.token} onChange={(e) => u({ token: e.target.value.trim() })} placeholder="tk_…" />
              </label>
              <p className="muted small-text">On the public ntfy.sh server anyone who knows the topic can read and post, so treat the topic like a password. For private teams, run your own ntfy server and use an access token.</p>
            </>
          ) : (
            <>
              <label className="field">
                <span>Radio channel</span>
                <select value={ch.channelIndex} onChange={(e) => u({ channelIndex: Number(e.target.value) })}>
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}: {radioChannels?.find((c) => c.index === i)?.name ?? (i === 0 ? 'Primary' : `Secondary ${i}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Channel share link from the Meshtastic app (Channels → Share), used for invites</span>
                <input value={ch.inviteUrl} onChange={(e) => u({ inviteUrl: e.target.value.trim() })} placeholder="https://meshtastic.org/e/#…" />
              </label>
            </>
          )}
          <label className="field">
            <span>Also post new reports to this channel</span>
            <select value={ch.shareAlerts} onChange={(e) => u({ shareAlerts: Number(e.target.value) as Severity })}>
              <option value={0}>Off (chat only)</option>
              <option value={2}>Warnings and up</option>
              <option value={3}>Serious and up</option>
              <option value={4}>Critical only</option>
            </select>
          </label>
        </div>
      )}
    </article>
  );
}

function JoinBox() {
  const pending = useStore((s) => s.joinCode);
  const [text, setText] = useState(pending ?? '');
  useEffect(() => {
    if (pending) setText(pending);
  }, [pending]);
  const parsed = useMemo(() => (text.trim() ? parseInvite(text) : null), [text]);
  const join = () => {
    if (!parsed) return;
    const dup = getState().channels.find((c) => (c.kind === 'ntfy' && parsed.kind === 'ntfy' && c.topic === parsed.topic && c.server === parsed.server) || (c.kind === 'mesh' && parsed.kind === 'mesh' && c.channelIndex === parsed.channelIndex));
    if (dup) {
      alert(`You're already in "${dup.name}".`);
      return;
    }
    saveChannels([...getState().channels, parsed]);
    setText('');
    setState({ joinCode: null });
    if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname + location.search);
  };
  return (
    <div className={`join ${pending ? 'pending' : ''}`}>
      <label className="field">
        <span>{pending ? 'You were invited to a team channel' : 'Join with an invite'}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an invite link, VG1 code, ntfy topic URL or Meshtastic channel link" />
      </label>
      {text.trim() && (
        <div className="field-row">
          {parsed ? (
            <span className="small-text">
              {parsed.kind === 'ntfy' ? `ntfy channel "${parsed.name}" on ${parsed.server.replace(/^https:\/\//, '')}` : `Meshtastic channel "${parsed.name}" (slot ${parsed.channelIndex})${parsed.inviteUrl ? '. Also open the channel link in the Meshtastic app so your radio joins.' : ''}`}
            </span>
          ) : (
            <span className="small-text crit">That isn't an invite this app recognises.</span>
          )}
          <button className="btn small primary" disabled={!parsed} onClick={join}>
            Join
          </button>
        </div>
      )}
    </div>
  );
}

function ChannelsManager() {
  const channels = useStore((s) => s.channels);
  const callsign = useStore((s) => s.settings.team.callsign);
  return (
    <div className="channels">
      <label className="field">
        <span>Your callsign (shown to the team)</span>
        <input value={callsign} onChange={(e) => setTeamSettings({ callsign: e.target.value.slice(0, 32) })} placeholder="e.g. Unit 7, Alpha-2, Jordan" />
      </label>
      {channels.map((c) => (
        <ChannelRow key={c.id} ch={c} />
      ))}
      <div className="field-row">
        <button className="btn small" onClick={() => saveChannels([...getState().channels, newNtfyChannel({ name: `${getPack(getState().packId).name} team` })])}>
          + New ntfy channel
        </button>
        <button className="btn small" onClick={() => saveChannels([...getState().channels, newMeshChannel()])}>
          + Meshtastic channel
        </button>
      </div>
      <JoinBox />
      <RadioPanel />
    </div>
  );
}

export function TeamTab() {
  const channels = useStore((s) => s.channels);
  const chat = useStore((s) => s.chat);
  const meshState = useStore((s) => s.meshStatus.state);
  const joinCode = useStore((s) => s.joinCode);
  const tz = useStore((s) => getPack(s.packId).timezone);
  const [active, setActive] = useState('all');
  const [manage, setManage] = useState(() => getState().channels.length === 0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => (active === 'all' ? chat : chat.filter((m) => m.channelId === active)).slice(-200), [chat, active]);
  useEffect(() => {
    setState({ teamSeenAt: Date.now() });
  }, [chat.length]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [rows.length, active]);
  const showManage = manage || !!joinCode;
  return (
    <div className="team">
      <div className="team-bar">
        <div className="chips">
          <button className={`chip ${active === 'all' ? 'on' : ''}`} onClick={() => setActive('all')}>
            All
          </button>
          {channels.map((c) => (
            <button key={c.id} className={`chip ${active === c.id ? 'on' : ''}`} onClick={() => setActive(c.id)}>
              <span className={`dot ${channelLive(c, meshState)}`} /> {c.name}
            </button>
          ))}
        </div>
        <button className={`btn small ${showManage ? 'on' : ''}`} onClick={() => setManage(!manage)}>
          Channels
        </button>
      </div>
      {showManage && <ChannelsManager />}
      <div className="msgs" ref={listRef}>
        {rows.map((m) => (
          <Message key={m.id} m={m} channel={channels.find((c) => c.id === m.channelId)} showChannel={active === 'all'} tz={tz} />
        ))}
        {!rows.length && channels.length > 0 && <div className="empty">No messages yet. Say hello, or share a spot from the map.</div>}
        {!channels.length && <div className="empty">Create a channel, then send its invite link to your team. ntfy works over the internet; Meshtastic works off-grid over radio.</div>}
      </div>
      <Composer channels={channels} active={active} />
    </div>
  );
}

/** Share button for any item with a location. */
export function ShareButton({ text, at, url, label }: { text: string; at?: [number, number] | null; url?: string; label?: string }) {
  return (
    <button
      className="btn small share"
      title="Share to team"
      onClick={(e) => {
        e.stopPropagation();
        shareToTeam(text, at ? { lat: at[1], lon: at[0], label } : undefined, url);
      }}
    >
      <Icon name="share" size={12} />Team
    </button>
  );
}

export { spotUrl };
