const fs = require('node:fs');
const path = require('node:path');

const variant = process.argv[2] || process.env.APP_VARIANT || 'free';
if (variant !== 'free') {
  throw new Error('This source checkout builds Home Ledger Free only.');
}

const appJsonPath = path.resolve(__dirname, '..', 'app.json');
const config = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const expo = config.expo;
if (!expo || !expo.android || !expo.extra) throw new Error('app.json is missing required Expo settings.');

expo.name = 'Home Ledger Free';
expo.scheme = 'home-ledger-free';
expo.android.package = 'app.homeledger.free';
expo.extra.appVariant = variant;
fs.writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
