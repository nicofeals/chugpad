// Development aid: exposes every module's exports as window.__chug so the app can be poked at from the
// browser console and from end-to-end tests. Not included in production builds (see main.ts).
import * as constants from './core/constants';
import * as state from './core/state';
import * as notes from './core/notes';
import * as wire from './sync/wire';
import * as cloud from './sync/cloud';
import * as engine from './audio/engine';
import * as playback from './audio/playback';
import * as render from './ui/render';
import * as editing from './ui/editing';
import * as sheets from './ui/sheets';
import * as capture from './ui/capture';
import * as actions from './ui/actions';
import * as exporters from './io/export';
import * as guitarpro from './io/guitarpro';

export function install(): void {
  const mods: Record<string, unknown>[] = [constants, state, notes, wire, cloud, engine, playback, render, editing, sheets, capture, actions, exporters, guitarpro];
  const find = (key: string | symbol) => (typeof key === 'string' ? mods.find((m) => key in m) : undefined);
  (window as any).__chug = new Proxy({}, {
    has: (_t, key) => !!find(key),
    get: (_t, key) => { const m = find(key); return m ? m[key as string] : undefined; }
  });
}
