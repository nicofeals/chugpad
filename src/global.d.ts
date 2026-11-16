// Things the browser or the page provides that TypeScript does not know about.
interface Window {
  FIREBASE_CONFIG?: { apiKey?: string; [key: string]: unknown };
  /** Set by tests to stand in for the Firebase SDK. */
  firebase?: any;
  /** The Guitar Pro reader, loaded from a CDN on first use. */
  alphaTab?: any;
  webkitAudioContext?: typeof AudioContext;
}
interface Navigator {
  audioSession?: { type: string };
}
