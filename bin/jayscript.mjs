#!/usr/bin/env node

import('../src/index.js').then(({ main }) => {
  main(process.argv.slice(2));
});