import { useEffect, useRef, useState } from 'react';
import { Game, CANVAS_W, CANVAS_H } from './engine.js';
import { P2PHost, P2PClient } from './p2p.js';
import { touchState, isTouchDevice } from './touch.js';
import './App.css';

const DIFFS = [
  { id: 'rookie', label: 'Rookie' },
  { id: 'pro', label: 'Pro' },
  { id: 'allstar', label: 'All-Star' },
];
const TIMES = [1, 2, 3];
const SLOT_LABELS = { b0: 'Blue 1', b1: 'Blue 2', o0: 'Orange 1', o1: 'Orange 2' };

const loadName = () => localStorage.getItem('ssl-name') || `Player ${10 + Math.floor(Math.random() * 89)}`;

export default function App() {
  const [screen, setScreen] = useState('menu');   // menu | game | online | end
  const [localOpts, setLocalOpts] = useState(null);
  const [result, setResult] = useState(null);

  return (
    <div className="shell">
      {screen === 'menu' && (
        <Menu
          onLocal={(opts) => { setLocalOpts(opts); setResult(null); setScreen('game'); }}
          onOnline={() => setScreen('online')}
        />
      )}
      {screen === 'game' && localOpts && (
        <LocalGame
          opts={localOpts}
          onEnd={(res) => { setResult(res); setScreen('end'); }}
          onQuit={() => setScreen('menu')}
        />
      )}
      {screen === 'online' && (
        <OnlineScreen onExit={() => setScreen('menu')} />
      )}
      {screen === 'end' && result && (
        <EndScreen
          result={result}
          rematchLabel="REMATCH ▸"
          onRematch={() => setScreen('game')}
          onMenu={() => setScreen('menu')}
        />
      )}
    </div>
  );
}

// ============================== MENU ==============================
function Menu({ onLocal, onOnline }) {
  const [mode, setMode] = useState('ai');
  const [difficulty, setDifficulty] = useState('pro');
  const [minutes, setMinutes] = useState(2);

  const play = () => {
    const slots = mode === '2p'
      ? [{ team: 'blue', ctrl: 'k1' }, { team: 'orange', ctrl: 'k2' }]
      : [{ team: 'blue', ctrl: 'k1' }, { team: 'orange', ctrl: 'bot' }];
    onLocal({ mode: 'local', slots, difficulty, minutes });
  };

  return (
    <div className="menu">
      <div className="menu-bg" aria-hidden="true" />
      <p className="kicker">// BROWSER EDITION</p>
      <h1 className="title">
        <span className="t-blue">SUPERSONIC</span>
        <span className="t-orange">LEAGUE</span>
      </h1>
      <p className="tagline">Car soccer. Boost. Goals. Chaos.</p>

      <div className="options">
        <div className="opt-group">
          <span className="opt-label">Mode</span>
          <div className="pills">
            <button className={mode === 'ai' ? 'pill on' : 'pill'} onClick={() => setMode('ai')}>
              1P vs. Bot
            </button>
            <button className={mode === '2p' ? 'pill on' : 'pill'} onClick={() => setMode('2p')}>
              2P Keyboard
            </button>
          </div>
        </div>
        {mode === 'ai' && (
          <div className="opt-group">
            <span className="opt-label">Difficulty</span>
            <div className="pills">
              {DIFFS.map((d) => (
                <button key={d.id} className={difficulty === d.id ? 'pill on' : 'pill'}
                        onClick={() => setDifficulty(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="opt-group">
          <span className="opt-label">Match time</span>
          <div className="pills">
            {TIMES.map((t) => (
              <button key={t} className={minutes === t ? 'pill on' : 'pill'}
                      onClick={() => setMinutes(t)}>
                {t} min
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="menu-btns">
        <button className="play-btn" onClick={play}>KICKOFF ▸</button>
        <button className="play-btn lan" onClick={onOnline}>PLAY WITH FRIENDS ▸</button>
      </div>

      <div className="controls-panel">
        <div className="ctrl-col">
          <h3 className="c-blue">{mode === '2p' ? 'Player 1 (Blue)' : 'Controls'}</h3>
          <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>{mode === '2p' ? '' : ' / Arrows'} — Drive</p>
          <p><kbd>Shift ⇧</kbd>{mode === '2p' ? ' left' : ' / Space'} — Boost</p>
          <p><kbd>Esc</kbd> — Pause</p>
        </div>
        {mode === '2p' && (
          <div className="ctrl-col">
            <h3 className="c-orange">Player 2 (Orange)</h3>
            <p><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> — Drive</p>
            <p><kbd>Shift ⇧</kbd> right — Boost</p>
          </div>
        )}
        {isTouchDevice() && (
          <div className="ctrl-col">
            <h3 className="c-gold">Touch</h3>
            <p>Left joystick — Drive</p>
            <p>Right button — Boost</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================== LOCAL GAME ==============================
function LocalGame({ opts, onEnd, onQuit }) {
  const canvasRef = useRef(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const game = new Game(canvasRef.current, opts, (res) => endRef.current(res));
    game.start();
    return () => game.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="game-wrap" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="game-canvas" />
      {isTouchDevice() && <TouchControls />}
      <div className="rotate-hint">🔄 Rotate your device for the full pitch</div>
      <button className="quit-btn" onClick={onQuit}>✕ Quit</button>
    </div>
  );
}

// ============================== ONLINE (P2P) ==============================
function OnlineScreen({ onExit }) {
  // entry | connecting | hostLobby | clientLobby | hostGame | clientGame | end | error
  const [step, setStep] = useState('entry');
  const [name, setNameState] = useState(loadName);
  const [joinCode, setJoinCode] = useState('');
  const [lobby, setLobby] = useState(null);
  const [startSlots, setStartSlots] = useState(null);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [myId, setMyId] = useState(null);
  const hostRef = useRef(null);
  const clientRef = useRef(null);
  const snapRef = useRef(null);

  useEffect(() => () => {         // cleanup on unmount
    hostRef.current?.destroy();
    clientRef.current?.destroy();
  }, []);

  const setName = (n) => {
    setNameState(n);
    localStorage.setItem('ssl-name', n);
    hostRef.current?.setName(n);
    clientRef.current?.setName(n);
  };

  const fail = (msg) => { setErrMsg(msg); setStep('error'); };

  const hostGame = () => {
    setIsHost(true);
    setMyId('host');
    setStep('connecting');
    const h = new P2PHost(name);
    hostRef.current = h;
    h.onLobby = setLobby;
    h.onReady = () => setStep('hostLobby');
    h.onError = () => fail('Could not reach the matchmaking service. Are you online?');
    h.start();
  };

  const joinGame = () => {
    if (joinCode.trim().length < 4) return;
    setIsHost(false);
    setStep('connecting');
    const c = new P2PClient(name);
    clientRef.current = c;
    c.onWelcome = (m) => setMyId(m.id);
    c.onLobby = (m) => { setLobby(m); setStep((s) => (s === 'clientGame' ? s : 'clientLobby')); };
    c.onStart = (m) => { setStartSlots(m.slots); setResult(null); setStep('clientGame'); };
    c.onSnap = (m) => snapRef.current?.(m);
    c.onEnd = (m) => { setResult(m.result); setStartSlots(null); setStep('end'); };
    c.onClosed = () => fail('Host disconnected.');
    c.onError = (err) => {
      if (err.type === 'peer-unavailable') fail(`Room "${joinCode.toUpperCase()}" not found — check the code.`);
      else if (['server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        fail('Could not reach the matchmaking service. Are you online?');
      }
    };
    c.connect(joinCode);
  };

  const startMatch = () => {
    const slots = hostRef.current?.startMatch();
    if (slots) { setStartSlots(slots); setResult(null); setStep('hostGame'); }
  };

  const backToLobby = () => setStep(isHost ? 'hostLobby' : 'clientLobby');

  if (step === 'entry') {
    return (
      <div className="menu lobby">
        <div className="menu-bg" aria-hidden="true" />
        <p className="kicker">// PLAY WITH FRIENDS</p>
        <h1 className="lobby-title">
          <span className="t-blue">ONLINE </span>
          <span className="t-orange">MATCH</span>
        </h1>
        <p className="hint">Peer-to-peer — one player hosts, everyone connects directly. Works on WiFi and over the internet.</p>

        <div className="opt-group">
          <span className="opt-label">Your name</span>
          <input className="name-input" value={name} maxLength={16}
                 onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="menu-btns">
          <button className="play-btn" onClick={hostGame}>HOST GAME ▸</button>
        </div>
        <div className="join-row">
          <input
            className="name-input code-input" placeholder="CODE" maxLength={4}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') joinGame(); }}
          />
          <button className="play-btn lan" onClick={joinGame} disabled={joinCode.trim().length < 4}>
            JOIN ▸
          </button>
        </div>
        <button className="pill big" onClick={onExit}>← Menu</button>
      </div>
    );
  }

  if (step === 'connecting') {
    return (
      <div className="menu">
        <div className="menu-bg" aria-hidden="true" />
        <h1 className="lobby-title">Connecting…</h1>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="menu">
        <div className="menu-bg" aria-hidden="true" />
        <h1 className="lobby-title">⚠ {errMsg}</h1>
        <button className="pill big" onClick={onExit}>← Menu</button>
      </div>
    );
  }

  if (step === 'hostGame' || step === 'clientGame') {
    return step === 'hostGame' ? (
      <HostGame
        host={hostRef.current} slots={startSlots} name={name}
        onEnd={(res) => { hostRef.current?.endMatch(res); setResult(res); setStep('end'); }}
        onQuit={() => { hostRef.current?.endMatch({ blue: 0, orange: 0, aborted: true }); setStep('hostLobby'); }}
      />
    ) : (
      <NetGame
        client={clientRef.current} myId={myId} slots={startSlots} snapRef={snapRef}
        onQuit={() => { clientRef.current?.quitMatch(); setStartSlots(null); setStep('clientLobby'); }}
      />
    );
  }

  if (step === 'end' && result) {
    return (
      <EndScreen
        result={result}
        rematchLabel="BACK TO LOBBY ▸"
        onRematch={backToLobby}
        onMenu={onExit}
      />
    );
  }

  return (
    <Lobby
      lobby={lobby} myId={myId} isHost={isHost} name={name} setName={setName}
      onSlot={(s) => (isHost ? hostRef.current?.claimSlot(s) : clientRef.current?.claimSlot(s))}
      onConfig={isHost ? (patch) => hostRef.current?.setConfig(patch) : null}
      onStart={isHost ? startMatch : null}
      onLeave={onExit}
    />
  );
}

function Lobby({ lobby, myId, isHost, name, setName, onSlot, onConfig, onStart, onLeave }) {
  if (!lobby) {
    return (
      <div className="menu">
        <div className="menu-bg" aria-hidden="true" />
        <h1 className="lobby-title">Joining room…</h1>
      </div>
    );
  }
  const { players, config, inGame, code } = lobby;
  const me = players.find((p) => p.id === myId);
  const slots = config.teamSize === 1 ? ['b0', 'o0'] : ['b0', 'b1', 'o0', 'o1'];
  const occupant = (key) => players.find((p) => p.slot === key);

  return (
    <div className="menu lobby">
      <div className="menu-bg" aria-hidden="true" />
      <p className="kicker">// {isHost ? 'YOU ARE HOSTING' : 'JOINED ROOM'}</p>
      <h1 className="lobby-title">
        <span className="t-blue">ROOM </span>
        <span className="t-orange">{code}</span>
      </h1>
      <p className="hint">
        Friends open this page and join with code <strong className="c-gold">{code}</strong>
      </p>

      <div className="options">
        <div className="opt-group">
          <span className="opt-label">Your name</span>
          <input className="name-input" value={name} maxLength={16}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="opt-group">
          <span className="opt-label">Teams</span>
          <div className="pills">
            {[1, 2].map((n) => (
              <button key={n} className={config.teamSize === n ? 'pill on' : 'pill'}
                      disabled={!onConfig}
                      onClick={() => onConfig?.({ teamSize: n })}>
                {n}v{n}
              </button>
            ))}
          </div>
        </div>
        <div className="opt-group">
          <span className="opt-label">Bot level</span>
          <div className="pills">
            {DIFFS.map((d) => (
              <button key={d.id} className={config.difficulty === d.id ? 'pill on' : 'pill'}
                      disabled={!onConfig}
                      onClick={() => onConfig?.({ difficulty: d.id })}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="opt-group">
          <span className="opt-label">Match time</span>
          <div className="pills">
            {TIMES.map((t) => (
              <button key={t} className={config.minutes === t ? 'pill on' : 'pill'}
                      disabled={!onConfig}
                      onClick={() => onConfig?.({ minutes: t })}>
                {t} min
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="slot-grid" data-size={config.teamSize}>
        {slots.map((key) => {
          const occ = occupant(key);
          const mine = me?.slot === key;
          const team = key[0] === 'b' ? 'blue' : 'orange';
          return (
            <button
              key={key}
              className={`slot ${team} ${mine ? 'mine' : ''} ${occ && !mine ? 'taken' : ''}`}
              onClick={() => onSlot(key)}
            >
              <span className="slot-name">{SLOT_LABELS[key]}</span>
              <span className="slot-occ">{occ ? occ.name + (mine ? ' (you)' : '') : '🤖 BOT — tap to join'}</span>
            </button>
          );
        })}
      </div>

      <p className="hint">
        {players.length} player{players.length === 1 ? '' : 's'} connected · empty seats are filled with bots
      </p>

      <div className="menu-btns">
        {onStart ? (
          <button className="play-btn" onClick={onStart} disabled={inGame}>
            {inGame ? 'MATCH RUNNING…' : 'START MATCH ▸'}
          </button>
        ) : (
          <p className="hint">{inGame ? 'Match running — you can spectate after it starts.' : 'Waiting for the host to start…'}</p>
        )}
        <button className="pill big" onClick={onLeave}>← Leave</button>
      </div>
    </div>
  );
}

// Host plays AND simulates: a local Game with net-controlled cars,
// broadcasting snapshots to all peers at ~30 Hz.
function HostGame({ host, slots, onEnd, onQuit }) {
  const canvasRef = useRef(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const game = new Game(canvasRef.current, {
      mode: 'local', slots, myId: 'host',
      difficulty: host.config.difficulty, minutes: host.config.minutes,
    }, (res) => endRef.current(res));
    game.start();

    host.onPeerInput = (id, i) => { game.netInputs[id] = i; };
    host.onPeerLeft = (id) => {
      const car = game.cars.find((c) => c.netId === id);
      if (car && car.ctrl === 'net') { game.makeBot(car); car.name += ' 🤖'; }
      delete game.netInputs[id];
    };
    const snapTimer = setInterval(() => host.sendSnap(game.getSnapshot()), 33);

    return () => {
      clearInterval(snapTimer);
      host.onPeerInput = null;
      host.onPeerLeft = null;
      game.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="game-wrap" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="game-canvas" />
      {isTouchDevice() && <TouchControls />}
      <div className="rotate-hint">🔄 Rotate your device for the full pitch</div>
      <button className="quit-btn" onClick={onQuit}>✕ End match</button>
    </div>
  );
}

function NetGame({ client, myId, slots, snapRef, onQuit }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const game = new Game(canvasRef.current, { mode: 'client', myId }, null);
    game.applyStart(slots);
    game.start();
    snapRef.current = (m) => game.applySnap(m);

    const inputTimer = setInterval(() => client.sendInput(game.clientControls()), 33);

    return () => {
      clearInterval(inputTimer);
      snapRef.current = null;
      game.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spectating = !slots.some((s) => s.netId === myId);

  return (
    <div className="game-wrap" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="game-canvas" />
      {isTouchDevice() && !spectating && <TouchControls />}
      {spectating && <div className="spectate-tag">SPECTATING</div>}
      <div className="rotate-hint">🔄 Rotate your device for the full pitch</div>
      <button className="quit-btn" onClick={onQuit}>✕ Leave</button>
    </div>
  );
}

// ============================== TOUCH ==============================
function TouchControls() {
  const baseRef = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [boostOn, setBoostOn] = useState(false);

  const stickMove = (e) => {
    const el = baseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    touchState.active = true;
    touchState.dx = dx / max;
    touchState.dy = dy / max;
    touchState.mag = Math.min(1, d / max);
    setKnob({ x: dx, y: dy });
  };
  const stickEnd = () => {
    touchState.active = false;
    touchState.dx = 0; touchState.dy = 0; touchState.mag = 0;
    setKnob({ x: 0, y: 0 });
  };

  useEffect(() => stickEnd, []);

  return (
    <>
      <div
        ref={baseRef}
        className="joystick"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stickMove(e); }}
        onPointerMove={(e) => { if (touchState.active) stickMove(e); }}
        onPointerUp={stickEnd}
        onPointerCancel={stickEnd}
      >
        <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button
        className={`boost-btn ${boostOn ? 'held' : ''}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); touchState.boost = true; setBoostOn(true); }}
        onPointerUp={() => { touchState.boost = false; setBoostOn(false); }}
        onPointerCancel={() => { touchState.boost = false; setBoostOn(false); }}
      >
        🔥
      </button>
    </>
  );
}

// ============================== END ==============================
function EndScreen({ result, rematchLabel, onRematch, onMenu }) {
  const blueWins = result.blue > result.orange;
  return (
    <div className="end">
      <div className="menu-bg" aria-hidden="true" />
      <p className="kicker">// FULL TIME{result.overtime ? ' — OVERTIME' : ''}</p>
      <h1 className={blueWins ? 'winner c-blue' : 'winner c-orange'}>
        {blueWins ? 'BLUE WINS' : 'ORANGE WINS'}
      </h1>
      <div className="final-score">
        <span className="c-blue">{result.blue}</span>
        <span className="sep">:</span>
        <span className="c-orange">{result.orange}</span>
      </div>
      <div className="end-btns">
        <button className="play-btn" onClick={onRematch}>{rematchLabel}</button>
        <button className="pill big" onClick={onMenu}>Main menu</button>
      </div>
    </div>
  );
}
