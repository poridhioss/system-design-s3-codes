// main.js - CLI Interactive Harness for Autocomplete Service
import readline from 'node:readline';
import { AutocompleteService } from './AutocompleteService.js';
import { QUERY_DATASET } from './dataset.js';

async function main() {
  const args = process.argv.slice(2);
  const service = new AutocompleteService({ k: 5 });

  console.log('Initializing Autocomplete In-Memory Engines with seed dataset...');
  service.initialize(QUERY_DATASET);
  console.log(`Indexed ${QUERY_DATASET.length} seed queries successfully.\n`);

  // Direct CLI lookup mode: node main.js <prefix> [engine]
  if (args.length > 0 && args[0] !== '--interactive' && args[0] !== '-i') {
    const prefix = args[0];
    const engine = args[1] || 'hash';
    const { suggestions, tookMs } = service.suggest(prefix, engine, 5);

    console.log(`Prefix Query: "${prefix}" [Engine: ${engine}]`);
    console.log(`Execution Time: ${(tookMs * 1000).toFixed(2)} us (${tookMs.toFixed(4)} ms)`);
    console.log('Suggestions:');
    if (suggestions.length === 0) {
      console.log('  (no suggestions found)');
    } else {
      suggestions.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.query.padEnd(25)} (score: ${item.frequency.toLocaleString()})`);
      });
    }
    return;
  }

  // Interactive REPL Mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=====================================================');
  console.log('   Autocomplete In-Memory Service - Interactive CLI   ');
  console.log('   Commands:                                         ');
  console.log('     :engine <trie|hash>      - Toggle active engine  ');
  console.log('     :stats                   - Print memory stats    ');
  console.log('     :quit or :exit           - Exit session          ');
  console.log('=====================================================\n');

  let currentEngine = 'hash';

  const promptUser = () => {
    rl.question(`[${currentEngine}] Enter search prefix > `, async (input) => {
      const trimmed = input.trim();

      if (trimmed === ':quit' || trimmed === ':exit') {
        rl.close();
        return;
      }

      if (trimmed.startsWith(':engine')) {
        const parts = trimmed.split(/\s+/);
        if (parts[1] && (parts[1] === 'trie' || parts[1] === 'hash')) {
          currentEngine = parts[1];
          console.log(`Active engine switched to: ${currentEngine}\n`);
        } else {
          console.log('Invalid engine. Choose "trie" or "hash".\n');
        }
        promptUser();
        return;
      }

      if (trimmed === ':stats') {
        const stats = service.getStats();
        console.log('\n--- In-Memory Footprint ---');
        console.log(`Trie Words:          ${stats.trie.totalWords}`);
        console.log(`Trie Nodes:          ${stats.trie.nodeCount}`);
        console.log(`Trie Memory:         ${(stats.trie.memoryBytes / 1024).toFixed(2)} KB`);
        console.log(`Flat Map Prefixes:   ${stats.flatPrefixMap.uniquePrefixes}`);
        console.log(`Flat Map Memory:     ${(stats.flatPrefixMap.memoryBytes / 1024).toFixed(2)} KB\n`);
        promptUser();
        return;
      }

      if (trimmed.length === 0) {
        promptUser();
        return;
      }

      const t0 = process.hrtime.bigint();
      const result = await service.suggestWithCache(trimmed, currentEngine, 5);
      const latencyUs = Number(process.hrtime.bigint() - t0) / 1000;

      console.log(`\nResults for "${trimmed}" [Source: ${result.source}] (${latencyUs.toFixed(2)} us):`);
      if (result.suggestions.length === 0) {
        console.log('  No matching prefixes.\n');
      } else {
        result.suggestions.forEach((s, idx) => {
          console.log(`  ${idx + 1}. ${s.query.padEnd(25)} (score: ${(s.frequency || s.score || 0).toLocaleString()})`);
        });
        console.log('');
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
