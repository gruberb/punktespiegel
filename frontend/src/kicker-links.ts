const playerNewsSlugById: Readonly<Record<string, string>> = {
  "pl-k00101435": "lars-lokotsch",
  "pl-k00144843": "arthur-5",
  "pl-k00068029": "jonas-hofmann",
  "pl-k00072881": "jonas-hofmann-2",
  "pl-k00079914": "marvin-schulz",
  "pl-k00154558": "marvin-schulz-2",
  "pl-k00092331": "bernardo-4",
  "pl-k00103767": "rogerio-5",
  "pl-k00120073": "silas-katompa-mvumpa",
  "pl-k00141169": "cleiton-3",
  "pl-k00143036": "romulo-8",
  "pl-k00154185": "francisco-fuma-a-mascarenhas-costa-pessoa",
};

export type KickerPlayerNewsLink = { url: string; direct: boolean };

export function kickerPlayerNewsLink(playerId: string, playerName: string): KickerPlayerNewsLink {
  const slug = playerNewsSlugById[playerId];
  if (slug) return { url: `https://www.kicker.de/${slug}/spieler-news`, direct: true };

  // Kicker does not expose a public player-news API, and canonical slugs can
  // contain collision suffixes that cannot be derived from the player's name.
  // A site-restricted search is honest and safer than linking to another
  // player's archive or a guessed 404 URL.
  const query = `site:kicker.de inurl:spieler-news "${playerName}"`;
  return { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, direct: false };
}
