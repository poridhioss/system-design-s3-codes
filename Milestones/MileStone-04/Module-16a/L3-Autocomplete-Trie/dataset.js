/**
 * dataset.js - Curated Production Query Corpus with Search Frequencies
 *
 * Represents real-world historical search logs exhibiting head-to-tail query volume skew
 * from high-scale food delivery, ride sharing, and ticketing platforms.
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
