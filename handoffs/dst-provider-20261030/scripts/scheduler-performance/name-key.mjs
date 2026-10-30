// Shared identity for names entered by managers and names read from CSV.
export const nameKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const reservedTeamName = value => { const key = nameKey(value); return key === 'none' || key.includes('|'); };
