/**
 * Production Typeahead Dataset: 25-Query Corpus with Search Frequencies.
 *
 * Represents real-world historical search logs exhibiting head-to-tail query volume skew
 * from high-scale food delivery, ride sharing, and ticketing platforms.
 * Preserves complete pedagogical parity with the previous Character Trie lab.
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
  { query: "sylhet to dhaka bus", frequency: 2400 },
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
 * @param {number} targetCount - Total number of synthetic queries to generate (e.g. 10,000).
 * @returns {Array<{ query: string, frequency: number }>}
 */
export function generateExpandedDataset(targetCount = 10000) {
  const seedQueries = QUERY_DATASET;
  const modifiers = [
    "delivery", "online", "recipe", "restaurant", "best",
    "near me", "price", "spicy", "combo", "family pack",
    "offer", "discount", "authentic", "homemade", "traditional"
  ];

  const dataset = [];

  // Ingest base seed items first
  for (const seed of seedQueries) {
    if (dataset.length >= targetCount) break;
    dataset.push({ query: seed.query, frequency: seed.frequency });
  }

  let counter = 1;
  while (dataset.length < targetCount) {
    const base = seedQueries[(counter - 1) % seedQueries.length];
    const mod = modifiers[counter % modifiers.length];
    const candidate = `${base.query} ${mod} ${counter}`;

    const rank = dataset.length + 1;
    const freq = Math.max(1, Math.floor(25000 / Math.pow(rank, 0.85)));
    dataset.push({ query: candidate, frequency: freq });
    counter++;
  }

  return dataset;
}
