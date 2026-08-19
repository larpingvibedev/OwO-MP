import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { usePlayerStore } from '../store/usePlayerStore';
import type { Track } from '../types';

export interface SyncPayload {
  type: 'SYNC_STATE' | 'PLAY_TRACK' | 'SEEK' | 'TOGGLE_PLAY' | 'SYNC_PLAYLISTS';
  track?: Track | null;
  isPlaying?: boolean;
  currentTime?: number;
  roomId?: string;
  senderId?: string;
}

class DeviceSyncManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private roomId: string = '';
  private deviceId: string = '';

  constructor() {
    this.deviceId = 'dev-' + Math.random().toString(36).substring(2, 8);
  }

  public joinRoom(roomCode: string, onConnected?: () => void) {
    this.roomId = roomCode.trim().toLowerCase();
    if (!this.roomId) return;

    // Destroy previous connection if any
    if (this.peer) {
      this.peer.destroy();
    }

    // Initialize peer
    const fullPeerId = `owo-sync-${this.roomId}-${this.deviceId}`;
    this.peer = new Peer(fullPeerId, {
      debug: 1
    });

    this.peer.on('open', (id) => {
      console.log('Sync Device connected with ID:', id);
      if (onConnected) onConnected();
      this.connectToExistingPeers();
    });

    this.peer.on('connection', (conn) => {
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.warn('Sync peer error:', err);
    });
  }

  private connectToExistingPeers() {
    // Attempt connecting to host peer if we are a joining device
    const hostPeerId = `owo-sync-${this.roomId}-host`;
    if (this.peer && this.peer.id !== hostPeerId) {
      const conn = this.peer.connect(hostPeerId);
      this.setupConnection(conn);
    }
  }

  private setupConnection(conn: DataConnection) {
    conn.on('open', () => {
      console.log('Connected to peer:', conn.peer);
      this.connections.set(conn.peer, conn);

      // Send initial state to newly connected peer
      const state = usePlayerStore.getState();
      conn.send({
        type: 'SYNC_STATE',
        track: state.currentTrack,
        isPlaying: state.isPlaying,
        currentTime: state.currentTime,
        senderId: this.deviceId
      } as SyncPayload);
    });

    conn.on('data', (data: any) => {
      this.handleIncomingPayload(data as SyncPayload);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
    });
  }

  private handleIncomingPayload(payload: SyncPayload) {
    if (payload.senderId === this.deviceId) return; // Ignore own messages

    const store = usePlayerStore.getState();

    switch (payload.type) {
      case 'SYNC_STATE':
      case 'PLAY_TRACK':
        if (payload.track && payload.track.id !== store.currentTrack?.id) {
          store.setCurrentTrack(payload.track, false);
        }
        if (payload.isPlaying !== undefined) store.setIsPlaying(payload.isPlaying);
        if (payload.currentTime !== undefined) store.setCurrentTime(payload.currentTime);
        break;

      case 'TOGGLE_PLAY':
        if (payload.isPlaying !== undefined) store.setIsPlaying(payload.isPlaying);
        break;

      case 'SEEK':
        if (payload.currentTime !== undefined) {
          store.setCurrentTime(payload.currentTime);
          const audio = document.querySelector('audio');
          if (audio) audio.currentTime = payload.currentTime;
        }
        break;
    }
  }

  public broadcast(payload: Omit<SyncPayload, 'senderId'>) {
    const fullPayload: SyncPayload = { ...payload, senderId: this.deviceId };
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(fullPayload);
      }
    });
  }

  public getDeviceId(): string {
    return this.deviceId;
  }
}

export const syncManager = new DeviceSyncManager();
