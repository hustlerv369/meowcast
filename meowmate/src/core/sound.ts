// Public export intentionally contains no upstream sound artwork.
export const SOUND_NAMES = [] as const;
export type SoundName = string;
export const Sound = { enabled:false, volume:0, async preload(){}, resume(){}, idle(){}, setEnabled(value:boolean){this.enabled=value;}, setVolume(value:number){this.volume=value;}, play(_name:string){} };
