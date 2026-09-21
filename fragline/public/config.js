// Deployment switches read by js/net.js (scripts/build-static.mjs writes its own copy into the static build).
// static: no game server here, so solo games run in the browser · server: WebSocket URL of a remote game server.
window.FRAGLINE_CONFIG = { static: false, server: null };
