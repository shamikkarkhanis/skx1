import { EventEmitter } from 'events';

// Singleton registry of per-note event emitters
const registry: Map<string, EventEmitter> = typeof global !== 'undefined'
  ? ((global as any).__noteEventRegistry ||= new Map<string, EventEmitter>())
  : new Map<string, EventEmitter>();

export function getNoteEmitter(noteId: string): EventEmitter {
  let em = registry.get(noteId);
  if (!em) {
    em = new EventEmitter();
    // Allow a few listeners safely
    em.setMaxListeners(100);
    registry.set(noteId, em);
  }
  return em;
}
