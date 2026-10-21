/**
 * NEXADOWN - Server Compatibility Forwarder
 * Forwards execution to the root production server.js
 */

const app = require('../server.js');

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0';
  app.listen(PORT, HOST, () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║      🚀 NEXADOWN 3D - Production Downloader Backend       ║
  ║                                                           ║
  ║   🌐 Web Dashboard: http://localhost:${PORT}               ║
  ║   ⚡ API Health:    http://localhost:${PORT}/api/health    ║
  ║   🛡️ Security:      SSRF Protected & Rate Limited         ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
