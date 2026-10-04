// Original static cat and native HTML attachment controls.
import {drawCat} from "../mochi/cat";
import type {UploadFrame} from "./sequence";
export interface UploadCanvasActions {ask():void;cancel():void;}
export class UploadCanvas {
 readonly el=document.createElement("div");private canvas=document.createElement("canvas");private label=document.createElement("p");private actions=document.createElement("div");
 constructor(actions:UploadCanvasActions){
  this.el.id="upload-layer";this.el.style.cssText="width:640px;height:178px;color:var(--ink);font:400 14px var(--font)";
  this.canvas.width=80;this.canvas.height=70;this.el.append(this.canvas,this.label,this.actions);
  for(const [label,fn] of [["Open in chat",actions.ask],["Back",actions.cancel]] as const){const b=document.createElement("button");b.textContent=label;b.style.cssText="min-height:44px;padding:8px 16px;font:inherit;color:var(--ink);background:var(--btn-bg);border:1px solid var(--border);border-radius:12px";b.onclick=fn;this.actions.append(b);}
 }
 draw(frame:UploadFrame,_time:number){const ctx=this.canvas.getContext("2d");if(ctx){ctx.clearRect(0,0,80,70);ctx.save();ctx.translate(40,35);drawCat(ctx,25,"calm");ctx.restore();}this.label.textContent=frame.chooseAlpha?"File ready":"Preparing attachment…";this.actions.hidden=!frame.chooseAlpha;}
}
