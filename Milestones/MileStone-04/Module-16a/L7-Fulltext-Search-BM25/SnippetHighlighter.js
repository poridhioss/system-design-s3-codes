/**
 * SnippetHighlighter.js
 *
 * Extracts contextual preview snippets from documents and highlights matching query terms.
 * Employs a sliding context window around matched tokens with boundary padding and <em> tags.
 */

export class SnippetHighlighter {
  /**
   * Generates a highlighted text snippet containing the matched query terms.
   *
   * @param {string} text - Full text content of the document.
   * @param {string[]} queryTokens - Analyzed query terms to highlight.
   * @param {number} [windowWords=10] - Number of context words to include before and after match.
   * @returns {string} HTML-escaped string with <em> highlighted terms.
   */
  static highlight(text, queryTokens, windowWords = 10) {
    if (typeof text !== "string" || text.trim() === "") {
      return "";
    }
    if (!Array.isArray(queryTokens) || queryTokens.length === 0) {
      const words = text.trim().split(/\s+/);
      return words.slice(0, windowWords * 2).join(" ") + (words.length > windowWords * 2 ? "..." : "");
    }

    const words = text.trim().split(/\s+/);
    const cleanQuerySet = new Set(
      queryTokens.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    );

    // Find all indices where words match any query token
    const matchIndices = [];
    for (let i = 0; i < words.length; i++) {
      const cleanWord = words[i].toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      // Check exact match or prefix/stem match
      for (const q of cleanQuerySet) {
        if (cleanWord === q || cleanWord.startsWith(q) || q.startsWith(cleanWord)) {
          matchIndices.push(i);
          break;
        }
      }
    }

    if (matchIndices.length === 0) {
      // Fallback: return leading words
      return words.slice(0, windowWords * 2).join(" ") + (words.length > windowWords * 2 ? "..." : "");
    }

    // Anchor snippet window around the first match
    const firstMatch = matchIndices[0];
    const startIndex = Math.max(0, firstMatch - windowWords);
    const endIndex = Math.min(words.length, firstMatch + windowWords + 1);

    const sliceWords = words.slice(startIndex, endIndex);

    // Highlight matching tokens within the slice
    const highlightedWords = sliceWords.map((word) => {
      const cleanWord = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      for (const q of cleanQuerySet) {
        if (cleanWord === q || cleanWord.startsWith(q) || q.startsWith(cleanWord)) {
          return `<em>${word}</em>`;
        }
      }
      return word;
    });

    const prefix = startIndex > 0 ? "... " : "";
    const suffix = endIndex < words.length ? " ..." : "";

    return prefix + highlightedWords.join(" ") + suffix;
  }
}
