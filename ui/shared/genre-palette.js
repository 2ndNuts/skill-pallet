const definitions=[
  ['audio','音','#C8EF78'],
  ['video','映像','#79B7FF'],
  ['image','画像','#F08B79'],
  ['ui','UI・Web','#B59AE8'],
  ['words','調査・文章','#E7C84B'],
  ['data','資料・データ','#55B9AE'],
  ['organize','整理・連携','#DF91B3']
];
export const GENRE_STYLES=Object.freeze(Object.fromEntries(definitions.map(([id,label,color])=>[id,Object.freeze({id,label,color})])));
export const GENRE_NAMES=Object.freeze(Object.fromEntries(definitions.map(([id,label])=>[id,label])));
export const NEUTRAL_GENRE=Object.freeze({id:'all',label:'すべて',color:'#B49A75'});
const normalizeGenre=id=>id==='media'?'video':id;
export const genreStyle=id=>Object.hasOwn(GENRE_STYLES,normalizeGenre(id))?GENRE_STYLES[normalizeGenre(id)]:NEUTRAL_GENRE;

export function skillGenreStyle(entry,activeGenre='all'){
  const active=genreStyle(activeGenre);
  if(active!==NEUTRAL_GENRE)return active;
  const skill=entry?.kind==='stack'?entry.members?.[0]:entry;
  const genres=Array.isArray(skill?.genres)?skill.genres:[];
  const primary=genres.map(normalizeGenre).find(id=>Object.hasOwn(GENRE_STYLES,id));
  return genreStyle(primary);
}
