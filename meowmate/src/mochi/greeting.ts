// Original short fade greeting; no upstream character animation sequence.
import {drawCat} from "./cat";
export const GREETING_END=.8;
export class Greeting {
 onComplete:(()=>void)|null=null;private started=0;private completed=true;
 start(){this.started=performance.now();this.completed=false;}
 hover(){this.finish();} interrupt(){this.completed=true;}
 get elapsed(){return (performance.now()-this.started)/1000;} get done(){return this.completed;}
 private finish(){if(!this.completed){this.completed=true;this.onComplete?.();}}
 draw(ctx:CanvasRenderingContext2D){ctx.clearRect(0,0,640,150);if(this.completed)return;ctx.save();ctx.globalAlpha=Math.min(1,this.elapsed/.15);ctx.translate(320,75);drawCat(ctx,30,"calm");ctx.restore();if(this.elapsed>=GREETING_END)this.finish();}
}
