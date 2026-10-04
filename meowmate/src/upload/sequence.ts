// Plain attachment progress state; no character choreography.
export const USC={W:640,T_PROG_START:0,T_DROP:0};
export interface UploadFrame {progress:number;chooseAlpha:number;}
class UploadSequence {
 isActive=false;uploadDuration=1;private started:number|null=null;
 enterZone(_x:number,_y:number){this.isActive=true;} updateCursor(_x:number,_y:number){} exitZone(){}
 performDrop(duration:number){this.uploadDuration=duration;this.started=performance.now();this.isActive=true;}
 deactivate(){this.isActive=false;this.started=null;}
 get dropped(){return this.started!==null;} sinceDrop(){return this.started===null?null:(performance.now()-this.started)/1000;}
 frame():UploadFrame{const progress=Math.min(1,(this.sinceDrop()??0)/Math.max(.01,this.uploadDuration));return {progress,chooseAlpha:progress===1?1:0};}
}
export const UploadSeq=new UploadSequence();
