export const SPORTS: { id: string; label: string; short: string; path: string }[] = [
  { id: 'nba', label: 'NBA', short: 'NBA', path: 'basketball/nba' },
  { id: 'nfl', label: 'NFL', short: 'NFL', path: 'football/nfl' },
  { id: 'mlb', label: 'MLB', short: 'MLB', path: 'baseball/mlb' },
  { id: 'nhl', label: 'NHL', short: 'NHL', path: 'hockey/nhl' },
  { id: 'wnba', label: 'WNBA', short: 'WNBA', path: 'basketball/wnba' },
  { id: 'epl', label: 'Premier League', short: 'Premier League', path: 'soccer/eng.1' },
  { id: 'laliga', label: 'La Liga', short: 'La Liga', path: 'soccer/esp.1' },
  { id: 'bundesliga', label: 'Bundesliga', short: 'Bundesliga', path: 'soccer/ger.1' },
  { id: 'seriea', label: 'Serie A', short: 'Serie A', path: 'soccer/ita.1' },
  { id: 'ligue1', label: 'Ligue 1', short: 'Ligue 1', path: 'soccer/fra.1' },
  { id: 'mls', label: 'MLS', short: 'MLS', path: 'soccer/usa.1' },
  { id: 'ucl', label: 'Champions League', short: 'Champions League', path: 'soccer/uefa.champions' },
  { id: 'ncaaf', label: 'College Football', short: 'College Football', path: 'football/college-football' },
  { id: 'ncaam', label: 'College Basketball', short: 'College Basketball', path: 'basketball/mens-college-basketball' },
];
export const sportOf = (id?: string) => SPORTS.find((x) => x.id === id) ?? SPORTS[0];

export const FOLDERS: Record<'Files' | 'Photos', { id: string; label: string }[]> = {
  Files: [
    { id: 'recent', label: 'Recents' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'documents', label: 'Documents' },
    { id: 'desktop', label: 'Desktop' },
  ],
  Photos: [
    { id: 'pictures', label: 'Pictures' },
    { id: 'screenshots', label: 'Screenshots' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'desktop', label: 'Desktop' },
  ],
};
export const CUSTOM = 'path:';
export const folderOf = (family: 'Files' | 'Photos', id?: string) =>
  id?.startsWith(CUSTOM) ? { id, label: id.slice(CUSTOM.length).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || id.slice(CUSTOM.length) } : FOLDERS[family].find((x) => x.id === id) ?? FOLDERS[family][0];
