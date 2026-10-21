/**
 * Vercel Serverless Function Bridge
 * Forwards all incoming API requests to the Express application
 */

const app = require('../server.js');

module.exports = app;
