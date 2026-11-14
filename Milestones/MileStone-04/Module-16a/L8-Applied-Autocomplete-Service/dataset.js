/**
 * dataset.js - Production Query Corpus with Search Frequencies
 *
 * Represents real-world historical search logs exhibiting head-to-tail query volume skew
 * from high-scale food delivery and transit ticketing platforms.
 * Preserves complete consistency with the query vocabulary from Labs 3 and 4.
 */

export const QUERY_DATASET = [
  // "kacchi" food prefix family (models the self-ending word invariant)
  { query: "kacchi biryani", frequency: 16400 },
  { query: "kacchi mutton", frequency: 9200 },
  { query: "kacchi", frequency: 8500 }, // Self-ending word: valid query and internal prefix
  { query: "kacchi beef", frequency: 4600 },
  { query: "kacchi basmati", frequency: 3100 },
  { query: "kacchi platter", frequency: 1800 },

  // "bhuna" & "bhorta" food prefix family
  { query: "bhuna khichuri", frequency: 7800 },
  { query: "bhuna khichuri beef", frequency: 5200 },
  { query: "bhuna gosht", frequency: 4100 },
  { query: "bhorta platter", frequency: 3900 },
  { query: "bhorta vat", frequency: 2600 },

  // Sweets prefix family
  { query: "roshogolla", frequency: 6400 },
  { query: "roshomalai", frequency: 5800 },

  // "dhaka" & "dhanmondi" city prefix family
  { query: "dhaka", frequency: 18500 }, // Self-ending word
  { query: "dhaka to chittagong", frequency: 14200 },
  { query: "dhaka to sylhet", frequency: 9600 },
  { query: "dhaka to cox's bazar", frequency: 8900 },
  { query: "dhanmondi", frequency: 7300 },
  { query: "dhanmondi lake", frequency: 3400 },

  // "chittagong" & "sylhet" city prefix family
  { query: "chittagong", frequency: 11200 },
  { query: "chittagong port", frequency: 4100 },
  { query: "chittagong to cox's bazar", frequency: 3800 },
  { query: "sylhet", frequency: 8300 },
  { query: "sylhet tea garden", frequency: 2900 },
  { query: "sylhet to dhaka bus", frequency: 2400 }
];

export const RAW_QUERIES = QUERY_DATASET;

/**
 * Returns a dictionary mapping normalized query strings to monthly search frequencies.
 * @returns {Record<string, number>}
 */
export function getQueryDictionary() {
  const dict = Object.create(null);
  for (const item of QUERY_DATASET) {
    dict[item.query.trim().toLowerCase()] = item.frequency;
  }
  return dict;
}

/**
 * Procedurally generates an expanded synthetic query dataset for high-concurrency benchmarks.
 * Employs a Zipfian power-law decay curve so that generated traffic mirrors production skew.
 *
 * @param {number} targetCount - Total number of synthetic queries to generate (default: 100,000).
 * @returns {Array<{ query: string, frequency: number }>}
 */
export function generateExpandedDataset(targetCount = 100000) {
  const seedQueries = QUERY_DATASET;
  const modifiers = [
    "delivery", "online", "recipe", "restaurant", "best",
    "near me", "price", "menu", "express", "offers",
    "review", "shop", "discount", "order now", "open 24 hours"
  ];
  const locations = [
    "dhanmondi", "gulshan", "banani", "uttara", "mirpur",
    "mohammadpur", "chittagong port", "agrabad", "sylhet sadar", "cox's bazar"
  ];

  const results = [];
  const seen = new Set();

  // 1. Ingest seed queries first
  for (const item of seedQueries) {
    results.push({ query: item.query, frequency: item.frequency });
    seen.add(item.query);
  }

  // 2. Procedurally generate realistic combinations up to targetCount
  let rank = seedQueries.length + 1;
  const maxFreq = seedQueries[0].frequency;

  for (const seed of seedQueries) {
    if (results.length >= targetCount) break;

    for (const mod of modifiers) {
      if (results.length >= targetCount) break;

      const q1 = `${seed.query} ${mod}`;
      if (!seen.has(q1)) {
        seen.add(q1);
        const freq = Math.max(1, Math.round(maxFreq / Math.pow(rank, 0.75)));
        results.push({ query: q1, frequency: freq });
        rank++;
      }

      for (const loc of locations) {
        if (results.length >= targetCount) break;

        const q2 = `${seed.query} ${mod} ${loc}`;
        if (!seen.has(q2)) {
          seen.add(q2);
          const freq = Math.max(1, Math.round(maxFreq / Math.pow(rank, 0.75)));
          results.push({ query: q2, frequency: freq });
          rank++;
        }
      }
    }
  }

  // Fallback generation if targetCount > permutations
  let fallbackIdx = 1;
  while (results.length < targetCount) {
    const seed = seedQueries[fallbackIdx % seedQueries.length];
    const q = `${seed.query} item ${fallbackIdx}`;
    if (!seen.has(q)) {
      seen.add(q);
      const freq = Math.max(1, Math.round(maxFreq / Math.pow(rank, 0.75)));
      results.push({ query: q, frequency: freq });
      rank++;
    }
    fallbackIdx++;
  }

  return results;
}
