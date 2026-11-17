import { app } from './app.js';
import { config } from './config.js';
import { attachLive } from './live.js';
import { startAutoOpen } from './services/auto-open.js';
import { startLedgerMail } from './services/ledger-mail.js';

const server = app.listen(config.port, () => {
  console.log(`OnlineLotto API listening on http://localhost:${config.port}`);
});
attachLive(server);
startAutoOpen(); // draft terms become Active at their open time
startLedgerMail(); // closed master terms email 00-99 / 000-999 to the chosen accounts
