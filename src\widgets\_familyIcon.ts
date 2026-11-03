export const customFamilyIcons = new Map<string, (size: number) => string>();
export function familyIcon(family: string, s = 22): string {
  const custom = customFamilyIcons.get(family);
  if (custom) return custom(s);
  const sq = (bg: string, inner: string) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="${bg}"/>${inner}</svg>`;
  switch (family) {
    case 'all':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="8" height="17" rx="2.2"/><rect x="14" y="3.5" width="6.5" height="7.5" rx="2"/><rect x="14" y="13" width="6.5" height="7.5" rx="2"/></svg>`;
    case 'Batteries':
      return sq('#34c759', `<rect x="4.5" y="8.2" width="13" height="7.6" rx="2" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="6.2" y="9.9" width="7" height="4.2" rx="1" fill="#fff"/><rect x="18.6" y="10.6" width="1.6" height="2.8" rx=".8" fill="#fff"/>`);
    case 'Calendar':
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="#fff"/><path d="M0 5.6A5.6 5.6 0 0 1 5.6 0h12.8A5.6 5.6 0 0 1 24 5.6V8H0Z" fill="#ff3b30"/><text x="12" y="20.2" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-size="11.5" font-weight="600" fill="#1c1c1e">${new Date().getDate()}</text></svg>`;
    case 'Clock':
      return sq('#1c1c1e', `<circle cx="12" cy="12" r="8.2" fill="#fff"/><path d="M12 6.6V12l3.4 2" stroke="#1c1c1e" stroke-width="1.5" stroke-linecap="round" fill="none"/>`);
    case 'Moon':
      return sq('#222a5c', `<path d="M16.8 14.4A6.2 6.2 0 0 1 9.6 6.2a6.2 6.2 0 1 0 7.2 8.2Z" fill="#f3eed8"/><circle cx="17" cy="7" r=".9" fill="#fff"/>`);
    case 'Notes':
      return sq('#ffd60a', `<rect x="6" y="5" width="12" height="14" rx="2" fill="#fff"/><path d="M9 9.5h6M9 12.5h6M9 15.5h3.5" stroke="#b58900" stroke-width="1.3" stroke-linecap="round"/>`);
    case 'Reminders':
      return sq('#fff', `<circle cx="7.4" cy="8" r="1.7" fill="#0a84ff"/><circle cx="7.4" cy="12" r="1.7" fill="#ff9f0a"/><circle cx="7.4" cy="16" r="1.7" fill="#ff453a"/><path d="M11 8h7M11 12h7M11 16h7" stroke="#c7c7cc" stroke-width="1.5" stroke-linecap="round"/>`);
    case 'Progress':
      return sq('#ff9f0a', `<circle cx="12" cy="12" r="7.4" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2.2"/><path d="M12 4.6a7.4 7.4 0 0 1 7.4 7.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`);
    case 'Quotes':
      return sq('#5e5ce6', `<text x="12" y="20" text-anchor="middle" font-family="Georgia,serif" font-size="22" font-weight="700" fill="#fff">“</text>`);
    case 'Sun':
      return sq('#0b1230', `<path d="M3.6 17.4A9 9 0 0 1 20.4 9" fill="none" stroke="#ff9f1c" stroke-width="1.7" stroke-linecap="round"/><circle cx="15.6" cy="8.6" r="2.6" fill="#ffd60a"/>`);
    case 'System':
      return sq('#636366', `<rect x="7.2" y="7.2" width="9.6" height="9.6" rx="1.8" fill="#fff"/><g stroke="#fff" stroke-width="1.4" stroke-linecap="round"><path d="M10 4.4v1.8M14 4.4v1.8M10 17.8v1.8M14 17.8v1.8M4.4 10h1.8M4.4 14h1.8M17.8 10h1.8M17.8 14h1.8"/></g><rect x="9.6" y="9.6" width="4.8" height="4.8" rx=".8" fill="#636366"/>`);
    case 'Weather':
      return sq('#3b8def', `<circle cx="9.4" cy="9.4" r="3.4" fill="#ffd60a"/><path d="M8.6 18.2a3.4 3.4 0 0 1-.3-6.8 4.4 4.4 0 0 1 8.5 1 2.9 2.9 0 0 1-.3 5.8Z" fill="#fff"/>`);
    default:
      return sq('#8e8e93', `<text x="12" y="17" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">${(family[0] || '?').toUpperCase().replace(/[<>&]/g, '')}</text>`);
  }
}
