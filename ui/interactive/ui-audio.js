import {createSoundCadence} from './sound-cadence.js';

const files=['wood-01.wav','wood-02.wav','wood-03.wav','wood-04.wav'];
const scrollFiles=['scroll-01.wav','scroll-02.wav','scroll-03.wav'];
export const SOUND_LEVELS=Object.freeze({hover:.28,collision:.24,startup:.42,success:.38});
export function soundLevel(kind,strength=1){return SOUND_LEVELS[kind]*(kind==='collision'?.45+.55*Math.max(0,Math.min(1,strength)):1);}

export function createUISound({native=false,sendNative=()=>{}}={}){
  const pools=new Map(),voiceKinds=new WeakMap();let enabled=false,successTimer=null;
  if(!native)for(const file of [...files,...scrollFiles,'../success-click.wav']){
    const relative=file.startsWith('../')?'../audio/success-click.wav':'../audio/ui/'+file;
    pools.set(file,Array.from({length:4},()=>{const audio=new Audio(new URL(relative,document.baseURI).href);audio.preload='auto';return audio;}));
  }
  function play(kind,take,strength=1){
    if(!enabled||document.hidden)return;
    if(native){sendNative(kind,take,strength);return;}
    if(successTimer!==null&&kind!=='success')return;
    if(kind==='success'){clearTimeout(successTimer);successTimer=null;}
    const playing=[...pools.values()].flat().filter(voice=>!voice.paused&&!voice.ended);
    if(kind==='success'&&playing.length){
      const remaining=Math.max(...playing.map(voice=>Number.isFinite(voice.duration)?Math.max(0,voice.duration-voice.currentTime):.4));
      successTimer=setTimeout(()=>{successTimer=null;play(kind,take);},Math.min(.45,Math.max(.02,remaining))*1000+15);return;
    }
    const pool=pools.get(kind==='success'?'../success-click.wav':kind==='collision'?scrollFiles[take%scrollFiles.length]:files[take%files.length]);
    const audio=pool.find(voice=>voice.paused||voice.ended);if(!audio)return;
    // Quiet movement contacts may share their natural tails. Other
    // interaction families stay separate; a hover never joins a moving rattle.
    if(kind==='collision'||kind==='startup'){
      if(playing.length>=2||playing.some(voice=>voiceKinds.get(voice)!==kind))return;
    }else if(playing.length>=1)return;
    voiceKinds.set(audio,kind);audio.volume=soundLevel(kind,strength);audio.currentTime=0;audio.play().catch(()=>{});
  }
  const cadence=createSoundCadence(play);
  return{
    ...cadence,
    setEnabled(value){enabled=!!value;cadence.setEnabled(value);if(!enabled){clearTimeout(successTimer);successTimer=null;for(const pool of pools.values())for(const audio of pool){audio.pause();audio.currentTime=0;}}}
  };
}
