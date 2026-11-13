// Display only. Canonical date keys and input values remain ISO strings.
export function displayDate(value){
 const s=String(value??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
 const d=new Date(s+'T12:00:00Z');if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==s)return s;
 return `${s.slice(5,7)}/${s.slice(8,10)}/${s.slice(0,4)}`;
}
export function displayMonth(value){const s=String(value??'');return /^\d{4}-(0[1-9]|1[0-2])$/.test(s)?`${s.slice(5,7)}/${s.slice(0,4)}`:s;}
export function displayPeriod(value){const s=String(value??'');const m=/^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(s);return m?`${displayDate(m[1])} to ${displayDate(m[2])}`:s;}
