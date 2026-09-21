// Static solo build: the authoritative Holdout room runs in this module worker. net.js's LocalSocket talks to it
// like a WebSocket — JSON strings both ways, snapshots come back as transferred ArrayBuffers.
import { startLocalServer } from './localserver.js';

const server = startLocalServer(d => typeof d === 'string' ? self.postMessage(d) : self.postMessage(d, [d]));
self.onmessage = e => server.receive(e.data);
self.postMessage('__ready'); // the whole import graph has loaded and the handler is attached
