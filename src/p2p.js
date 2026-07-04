// ============================================================
//  Peer-to-peer transport (WebRTC via PeerJS) — no own backend.
//  One player hosts: their browser runs the simulation and
//  relays snapshots; everyone else connects directly to them.
//  PeerJS' free cloud broker is only used for the handshake;
//  after that all game data flows peer-to-peer.
// ============================================================
import Peer from 'peerjs';

const PREFIX = 'supersonic-league-v2-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class P2PHost {
  constructor(name) {
    this.name = name;
    this.code = null;
    this.peer = null;
    this.conns = new Map();      // id -> { conn, name, slot }
    this.nextId = 1;
    this.config = { teamSize: 2, difficulty: 'pro', minutes: 2 };
    this.slot = 'b0';            // host starts in Blue 1
    this.inGame = false;
    this.slotsInfo = null;
    // callbacks assigned by the UI
    this.onReady = null;
    this.onLobby = null;
    this.onPeerInput = null;
    this.onPeerLeft = null;
    this.onError = null;
  }

  start(attempt = 0) {
    const code = makeCode();
    const peer = new Peer(PREFIX + code);
    this.peer = peer;
    peer.on('open', () => {
      this.code = code;
      this.onReady?.(code);
      this.emitLobby();
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy();
        this.start(attempt + 1);          // code collision: roll a new one
      } else if (['server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        this.onError?.(err);
      }
    });
  }

  accept(conn) {
    conn.on('data', (m) => this.handle(conn, m));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  handle(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const id = 'p' + this.nextId++;
      conn._sslId = id;
      this.conns.set(id, { conn, name: String(m.name || id).slice(0, 16), slot: null });
      conn.send({ t: 'welcome', id });
      if (this.inGame) conn.send({ t: 'start', slots: this.slotsInfo, config: this.config, spectator: true });
      this.emitLobby();
      return;
    }
    const id = conn._sslId;
    const entry = id && this.conns.get(id);
    if (!entry) return;
    switch (m.t) {
      case 'name':
        entry.name = String(m.name || '').slice(0, 16) || entry.name;
        this.emitLobby();
        break;
      case 'slot': {
        const s = m.slot;
        if (entry.slot === s) entry.slot = null;
        else if (this.validSlots().includes(s) && !this.slotTaken(s)) entry.slot = s;
        this.emitLobby();
        break;
      }
      case 'input':
        this.onPeerInput?.(id, { th: +m.th || 0, st: +m.st || 0, b: m.b ? 1 : 0 });
        break;
      case 'quit':
        entry.slot = null;
        if (this.inGame) this.onPeerLeft?.(id);
        this.emitLobby();
        break;
    }
  }

  drop(conn) {
    const id = conn._sslId;
    if (!id || !this.conns.has(id)) return;
    this.conns.delete(id);
    if (this.inGame) this.onPeerLeft?.(id);
    this.emitLobby();
  }

  validSlots() {
    return this.config.teamSize === 1 ? ['b0', 'o0'] : ['b0', 'b1', 'o0', 'o1'];
  }

  slotTaken(s) {
    if (this.slot === s) return true;
    for (const e of this.conns.values()) if (e.slot === s) return true;
    return false;
  }

  players() {
    return [
      { id: 'host', name: this.name, slot: this.slot },
      ...[...this.conns.entries()].map(([id, e]) => ({ id, name: e.name, slot: e.slot })),
    ];
  }

  lobbyMsg() {
    return { t: 'lobby', code: this.code, players: this.players(), config: this.config, inGame: this.inGame };
  }

  emitLobby() {
    const msg = this.lobbyMsg();
    this.broadcast(msg);
    this.onLobby?.(msg);
  }

  broadcast(obj) {
    for (const e of this.conns.values()) {
      if (e.conn.open) e.conn.send(obj);
    }
  }

  // ---- host UI actions ----
  setName(name) { this.name = name; this.emitLobby(); }
  claimSlot(s) {
    if (this.slot === s) this.slot = null;
    else if (this.validSlots().includes(s) && !this.slotTaken(s)) this.slot = s;
    this.emitLobby();
  }
  setConfig(patch) {
    if ([1, 2].includes(patch.teamSize)) this.config.teamSize = patch.teamSize;
    if (['rookie', 'pro', 'allstar'].includes(patch.difficulty)) this.config.difficulty = patch.difficulty;
    if ([1, 2, 3, 5].includes(patch.minutes)) this.config.minutes = patch.minutes;
    const valid = this.validSlots();
    if (this.slot && !valid.includes(this.slot)) this.slot = null;
    for (const e of this.conns.values()) if (e.slot && !valid.includes(e.slot)) e.slot = null;
    this.emitLobby();
  }

  startMatch() {
    if (this.inGame) return null;
    const slots = [];
    let botN = 1;
    for (const team of ['blue', 'orange']) {
      for (let i = 0; i < this.config.teamSize; i++) {
        const key = (team === 'blue' ? 'b' : 'o') + i;
        if (this.slot === key) {
          slots.push({ team, ctrl: 'k1', netId: 'host', name: this.name });
          continue;
        }
        let human = null;
        for (const [id, e] of this.conns) if (e.slot === key) human = { id, e };
        slots.push(human
          ? { team, ctrl: 'net', netId: human.id, name: human.e.name }
          : { team, ctrl: 'bot', netId: null, name: `BOT-${botN++}` });
      }
    }
    this.slotsInfo = slots;
    this.inGame = true;
    this.broadcast({ t: 'start', slots, config: this.config });
    this.emitLobby();
    return slots;
  }

  sendSnap(snap) { this.broadcast({ t: 'snap', ...snap }); }

  endMatch(result) {
    this.inGame = false;
    this.slotsInfo = null;
    this.broadcast({ t: 'end', result });
    this.emitLobby();
  }

  destroy() {
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}

export class P2PClient {
  constructor(name) {
    this.name = name;
    this.peer = null;
    this.conn = null;
    this.id = null;
    this.onWelcome = null;
    this.onLobby = null;
    this.onStart = null;
    this.onSnap = null;
    this.onEnd = null;
    this.onClosed = null;
    this.onError = null;
  }

  connect(code) {
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + String(code).trim().toUpperCase(), { reliable: true });
      this.conn = conn;
      conn.on('open', () => conn.send({ t: 'hello', name: this.name }));
      conn.on('data', (m) => this.handle(m));
      conn.on('close', () => this.onClosed?.());
      conn.on('error', () => this.onClosed?.());
    });
    peer.on('error', (err) => this.onError?.(err));
  }

  handle(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'welcome': this.id = m.id; this.onWelcome?.(m); break;
      case 'lobby': this.onLobby?.(m); break;
      case 'start': this.onStart?.(m); break;
      case 'snap': this.onSnap?.(m); break;
      case 'end': this.onEnd?.(m); break;
    }
  }

  send(obj) { if (this.conn?.open) this.conn.send(obj); }
  setName(name) { this.name = name; this.send({ t: 'name', name }); }
  claimSlot(s) { this.send({ t: 'slot', slot: s }); }
  sendInput(i) { this.send({ t: 'input', ...i }); }
  quitMatch() { this.send({ t: 'quit' }); }

  destroy() {
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}
