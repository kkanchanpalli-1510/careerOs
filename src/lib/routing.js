// src/lib/routing.js
// Equivalent of routing.ts — determines where to send a user after login.

/**
 * @param {{ insights?: { strength?: string } }} session
 * @returns {string}
 */
export function getDefaultRoute(session) {
  // First visit — no insight yet, show graph for wow moment
  if (!session?.insights?.strength) return '/graph';

  // Returning user — show workspace
  return '/workspace';
}
