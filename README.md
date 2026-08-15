
const { join } = require('path');

/**
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  // Configura o cache para uma pasta dentro do diretório do projeto que tem permissão
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
