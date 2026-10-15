// Optional deployment overrides (SPEC §8), loaded before js/ui/main.js. Everything is
// commented out: by default the game uses the public PeerJS cloud for signalling with
// public STUN servers, and the WebSocket relay when the page is served by
// server/relay-server.js.
//
// window.HH_CONFIG = {
//   // Your own PeerJS server (npx peerjs --port 9000) and a TURN server for players
//   // behind strict NATs / corporate firewalls:
//   peer: {
//     host: 'peer.example.com', port: 443, path: '/', secure: true, key: 'peerjs',
//     config: {
//       iceServers: [
//         { urls: 'stun:stun.l.google.com:19302' },
//         { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'secret' },
//       ],
//     },
//   },
//   // A relay server on another origin (the page itself is on static hosting):
//   relayUrl: 'wss://horde.example.com/relay',
// };
window.HH_CONFIG = window.HH_CONFIG || {};
