/**
 * Security utilities for sanitizing user input
 */

/**
 * Escapes special regex characters to prevent ReDoS attacks
 * and NoSQL injection via regex patterns
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string safe for use in regex
 */
export function escapeRegex(str) {
  if (typeof str !== 'string') {
    return '';
  }
  // Escape all special regex characters
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates and sanitizes search terms for MongoDB queries
 * @param {string} searchTerm - The search term to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 100)
 * @returns {string} - Sanitized search term
 */
export function sanitizeSearchTerm(searchTerm, maxLength = 100) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return '';
  }

  // Trim and limit length
  const trimmed = searchTerm.trim().slice(0, maxLength);

  // Escape regex special characters
  return escapeRegex(trimmed);
}
