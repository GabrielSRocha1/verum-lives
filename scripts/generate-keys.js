// Gera as chaves obrigatórias para o .env de produção.
import crypto from 'node:crypto';
const k = () => crypto.randomBytes(32).toString('hex');
console.log(`DATA_ENCRYPTION_KEY=${k()}\nINDEX_KEY=${k()}\nAPP_SECRET=${k()}`);
console.log('\n# Guarde estas chaves em local seguro. Perder DATA_ENCRYPTION_KEY torna os dados pessoais ilegíveis;');
console.log('# trocar INDEX_KEY quebra a busca por e-mail/telefone dos inscritos existentes.');
