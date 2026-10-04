// Original Meowmate renderer. No inherited character choreography.
import {drawCat,drawCatCompanion,catExpression} from "./cat";
import type {BotStateName,BotEmoteName} from "../core/layout";
export type RGB=readonly [number,number,number];
export type EyeShape="pill"|"wide"|"dot"|"line"|"flat"|"happy"|"closed"|"spiral"|"heart"|"star"|"tired"|"wink"|"cup";
export function hexToRGB(hex:string):RGB{const n=parseInt(hex.replace("#",""),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];}
export class BotEngine {
 isMini=false;fullBody=false;faceColor="#202020";bodyColor:RGB|null=null;
 state:BotStateName="idle";morph=0;particleOverhang=0;lookX=0;lookY=0;tgEs=1;
 slotH=0;slotHTarget=0;slotHVel=0;permanentEye:EyeShape|null=null;eyeOverride:EyeShape|null=null;eyeOverrideUntil=0;
 onDizzy:(()=>void)|null=null;private time=0;
 setState(next:BotStateName,_force=false){this.state=next;}
 setPermanentEmote(emote:BotEmoteName|null){this.eyeOverride=emote==="happy"?"happy":null;this.eyeOverrideUntil=Infinity;}
 triggerEmote(emote:BotEmoteName,_duration=1){this.eyeOverride=emote==="happy"?"happy":null;this.eyeOverrideUntil=performance.now()/1000+1;}
 blink(){} squash(){} gulp(){} slap(){} greet(){} interruptGreet(){}
 animateMorph(value:number){this.morph=value;} resetMorph(){this.morph=0;}
 get busy(){return false;}
 update(dt:number){this.time+=Math.max(0,Math.min(dt,.1));if(performance.now()/1000>this.eyeOverrideUntil)this.eyeOverride=this.permanentEye;}
 draw(ctx:CanvasRenderingContext2D,width:number,height:number){
  const light=typeof matchMedia!=="undefined" && matchMedia("(prefers-color-scheme: light)").matches;
  const color=this.bodyColor?`rgb(${this.bodyColor.map(v=>Math.round(v*255)).join(",")})`:light?"#505050":"#D0D0D0";
  const ink=this.fullBody?this.faceColor:light?"#F5F5F5":"#202020";
  ctx.save();ctx.translate(width/2,height/2+this.particleOverhang/2);
  const reduce=typeof matchMedia!=="undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  ctx.globalAlpha=reduce?1:.98+.02*Math.cos(this.time*1.5);
  if(this.fullBody)drawCatCompanion(ctx,Math.min(width,height)*.4,catExpression(this.eyeOverride??this.state),color,ink);
  else drawCat(ctx,Math.min(width,height)*.3,catExpression(this.eyeOverride??this.state),color,ink);
  ctx.restore();
 }
}
