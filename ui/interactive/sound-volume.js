export const PREVIEW_SOUND_VOLUME_KEY='skillPallet.previewSoundVolume.v1';
export const SOUND_VOLUMES=Object.freeze([
  Object.freeze({value:0,label:'OFF',gain:0}),
  Object.freeze({value:1,label:'標準',gain:1}),
  Object.freeze({value:2,label:'大',gain:2})
]);
export const soundVolume=value=>SOUND_VOLUMES.find(level=>level.value===value)||SOUND_VOLUMES[0];
export const volumeFromState=state=>SOUND_VOLUMES.some(level=>level.value===state.soundVolume)?state.soundVolume:state.sound?1:0;
export const nextSoundVolume=value=>(soundVolume(value).value+1)%SOUND_VOLUMES.length;
export function soundVolumeIcon(value){
  const volume=soundVolume(value).value;
  const waves=['M10 7.5a4 4 0 0 1 0 5','M12.5 5a7.5 7.5 0 0 1 0 10','M15 2.5a11 11 0 0 1 0 15'];
  const paths=volume===0?'<path d="m11.5 7 5 6m0-6-5 6"/>':waves.slice(0,volume===2?3:2).map(d=>`<path d="${d}"/>`).join('');
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5 4 7.5H1.5v5H4l3.5 3z"/>${paths}</svg>`;
}
