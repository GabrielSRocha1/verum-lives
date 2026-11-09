// Cria ou redefine um usuário do painel.
// Uso: npm run admin:create -- email@dominio.com [admin|viewer]
// A senha é lida do terminal (sem eco) ou da variável ADMIN_PASSWORD.
import readline from 'node:readline';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createCipher } from '../src/lib/crypto.js';
import { createAuthService } from '../src/services/auth.js';

const [email, role = 'admin'] = process.argv.slice(2);
if (!email) {
  console.error('Uso: npm run admin:create -- email@dominio.com [admin|viewer]');
  process.exit(1);
}

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const password = process.env.ADMIN_PASSWORD || await askHidden('Senha (mín. 12 caracteres, 3 tipos): ');
const config = loadConfig();
const db = openDatabase(config.dbFile);
const auth = createAuthService({ db, clock: Date.now, config, cipher: createCipher(config.keys.data, config.keys.index) });
try {
  const r = auth.createAdmin(email, password, role);
  console.log(`${r.updated ? 'Atualizado' : 'Criado'}: ${r.email} (${r.role})`);
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
