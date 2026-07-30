/** Dead-simple synchronous event bus. Systems talk through this, not to each other. */
export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    let list = this.map.get(type);
    if (!list) this.map.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }

  off(type, fn) {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    const list = this.map.get(type);
    if (!list) return;
    // copy so handlers may unsubscribe mid-dispatch
    for (const fn of list.slice()) {
      try { fn(payload); } catch (err) { console.error(`[events] handler for "${type}" threw`, err); }
    }
  }

  clear() { this.map.clear(); }
}

/** Canonical event names, so typos surface as missing constants. */
export const EV = {
  UNIT_SPAWNED: 'unit:spawned',
  UNIT_DIED: 'unit:died',
  BUILDING_PLACED: 'building:placed',
  BUILDING_COMPLETE: 'building:complete',
  BUILDING_DESTROYED: 'building:destroyed',
  DAMAGE: 'combat:damage',
  RESOURCE_CHANGED: 'res:changed',
  TECH_STARTED: 'tech:started',
  TECH_DONE: 'tech:done',
  SELECTION_CHANGED: 'sel:changed',
  QUEUE_CHANGED: 'prod:queue',
  ALERT: 'ui:alert',
  UNDER_ATTACK: 'ui:underAttack',
  GAME_OVER: 'game:over',
  ZONE_CHANGED: 'zone:changed',
};
