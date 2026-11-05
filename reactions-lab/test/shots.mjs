import { launch, open, view, HERE } from './harness.mjs';
import path from 'node:path';
// node shots.mjs name:x,y,z,yaw,pitch ...
const b = await launch(); const { page, log } = await open(b, { quality: process.env.Q || 'HIGH' });
console.log('boot errors', log.errors.slice(0, 8));
for (const a of process.argv.slice(2)) { const [name, v] = a.split(':'); const [x, y, z, yaw, pitch] = v.split(',').map(Number); await view(page, x, y, z, yaw, pitch, 4); await page.screenshot({ path: path.join(HERE, 'out', name + '.png'), timeout: 300000 }); console.log(name); }
console.log('errors', log.errors.slice(0, 8), 'blocked', log.blocked.slice(0, 3)); await b.close();
