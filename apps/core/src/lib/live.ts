/**
 * The media server for live lessons (LiveKit). The API never carries audio or video: it decides who may
 * enter a room and what they may do there, and hands the browser a short-lived token saying so.
 */
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from '../config';

/** How long a join token is valid. Long enough to connect; the connection itself then lasts the lesson. */
const TOKEN_TTL = '10m';

export type LiveRole = 'host' | 'listener';

export interface LiveGateway {
  /** A token letting `identity` into `room` with the rights of `role`. */
  joinToken(room: string, identity: string, name: string, role: LiveRole): Promise<string>;
  /** Gives or takes back the microphone of someone already in the room. */
  setCanSpeak(room: string, identity: string, canSpeak: boolean): Promise<void>;
  /** Ends the room for everyone in it. */
  closeRoom(room: string): Promise<void>;
}

let replaced = false;

export function isLiveConfigured(): boolean {
  return replaced || Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);
}

/** The address browsers connect to. */
export const liveUrl = () => config.LIVEKIT_URL ?? '';

/** What a listener may publish once the teacher gives her the microphone: her voice, nothing else. */
const listenerRights = (canSpeak: boolean) => ({
  canSubscribe: true,
  canPublishData: false,
  canPublish: canSpeak,
  canPublishSources: canSpeak ? [TrackSource.MICROPHONE] : [],
});

class LiveKitGateway implements LiveGateway {
  private rooms() {
    // The API talks to the server over HTTP(S); browsers use the same host over WS(S).
    const host = (config.LIVEKIT_API_URL ?? config.LIVEKIT_URL!).replace(/^ws/, 'http');
    return new RoomServiceClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  }

  async joinToken(room: string, identity: string, name: string, role: LiveRole) {
    const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity, name, ttl: TOKEN_TTL });
    token.addGrant(role === 'host'
      ? { room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false }
      : { room, roomJoin: true, ...listenerRights(false) });
    return token.toJwt();
  }

  async setCanSpeak(room: string, identity: string, canSpeak: boolean) {
    await this.rooms().updateParticipant(room, identity, { permission: listenerRights(canSpeak) });
  }

  async closeRoom(room: string) {
    await this.rooms().deleteRoom(room);
  }
}

let gateway: LiveGateway = new LiveKitGateway();

/** Replaces the gateway (tests use this to avoid needing a media server). */
export function setLiveGateway(next: LiveGateway | null) {
  gateway = next ?? new LiveKitGateway();
  replaced = next !== null;
}

export const live = (): LiveGateway => gateway;
