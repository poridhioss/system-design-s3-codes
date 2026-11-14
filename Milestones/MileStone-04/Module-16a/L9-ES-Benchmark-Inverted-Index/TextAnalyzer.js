/**
 * TextAnalyzer.js - Production Solution
 *
 * Implements a modular 5-stage text processing and Lexicon construction engine:
 * 1. Normalization: Lowercase conversion and Unicode punctuation stripping.
 * 2. Tokenization: Whitespace-based stream splitting.
 * 3. Stop-word Filtering: O(1) set-based elimination of high-frequency grammatical glue.
 * 4. Suffix Stemming: Algorithmic stripping of English plural and verb inflections.
 * 5. Lexicon Construction: Assigning monotonic integer Term IDs and tracking term/document frequencies.
 */

export const DEFAULT_STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
  "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
  "with", "would", "you", "your", "yours", "yourself", "yourselves",
]);

export class TextAnalyzer {
  constructor(options = {}) {
    this.stopwords = options.stopwords instanceof Set ? options.stopwords : DEFAULT_STOPWORDS;
    this.minTokenLength = typeof options.minTokenLength === "number" ? options.minTokenLength : 2;
    this.lexicon = new Map();
    this.nextTermId = 1;
  }

  normalize(text) {
    if (typeof text !== "string") return "";
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim();
  }

  tokenize(text) {
    const clean = this.normalize(text);
    if (!clean) return [];
    return clean.split(/\s+/);
  }

  filterStopWords(tokens) {
    if (!Array.isArray(tokens)) return [];
    return tokens.filter((token) => {
      if (token.length < this.minTokenLength) return false;
      return !this.stopwords.has(token);
    });
  }

  stem(word) {
    if (typeof word !== "string" || word.length <= 4) return word;

    if (word.endsWith("ing")) {
      return word.slice(0, -3);
    }
    if (word.endsWith("ed")) {
      return word.slice(0, -2);
    }
    if (word.endsWith("ies") && word.length > 4) {
      return word.slice(0, -3) + "y";
    }
    if (/(?:[xz]|[cs]h)es$/.test(word)) {
      return word.slice(0, -2);
    }
    // Guard root words ending in double-s or Latin/Greek roots (-us, -is)
    if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
      return word;
    }
    if (word.endsWith("s")) {
      return word.slice(0, -1);
    }

    return word;
  }

  analyze(text) {
    const tokens = this.tokenize(text);
    const filtered = this.filterStopWords(tokens);
    return filtered.map((token) => this.stem(token));
  }

  termFrequencies(tokens) {
    const counts = new Map();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return counts;
  }

  buildLexicon(corpus) {
    if (!Array.isArray(corpus)) return this.lexicon;

    for (const doc of corpus) {
      const fullText = `${doc.title} ${doc.body}`;
      const tokens = this.analyze(fullText);
      const uniqueDocTerms = new Set(tokens);
      const tfCounts = this.termFrequencies(tokens);

      for (const term of uniqueDocTerms) {
        if (!this.lexicon.has(term)) {
          this.lexicon.set(term, {
            termId: this.nextTermId++,
            docFreq: 1,
            totalCount: tfCounts.get(term) || 1,
          });
        } else {
          const entry = this.lexicon.get(term);
          entry.docFreq += 1;
          entry.totalCount += tfCounts.get(term) || 0;
        }
      }
    }

    return this.lexicon;
  }

  getTermId(term) {
    const entry = this.lexicon.get(term);
    return entry ? entry.termId : null;
  }
}
