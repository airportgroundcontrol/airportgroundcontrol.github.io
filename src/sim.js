import createGraph from 'ngraph.graph';
import { aStar } from 'ngraph.path';

export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const statusNames={gate:'Ready for pushback',pushback:'Pushing back',ready:'Awaiting taxi',taxi:'Taxiing out',holding:'Holding short',lineup:'Lining up',linedup:'Ready for departure',takeoff:'Taking off',approach:'Inbound / awaiting clearance',landing:'Landing / vacating',inbound:'Awaiting stand',taxiin:'Taxiing to stand',parked:'On stand',done:'Departed'};
export class GroundSim {
  constructor(data){
    this.data=data;this.nodes=new Map(data.nodes.map(n=>[n.id,n]));this.stands=new Map(data.stands.map(s=>[s.id,s]));
    this.graph=createGraph();for(const n of data.nodes)this.graph.addNode(n.id,n);for(const e of data.edges)this.graph.addLink(e.a,e.b,e);
    this.reset();
  }
  reset(){this.time=0;this.score=0;this.completed=0;this.incidents=0;this.planes=[];this.logs=[];this.nextId=1;this.runwayOwner=null;this.nextArrival=210;this.nextDeparture=260;this.conflictPairs=new Set();this.finished=false;
    for(const [i,stand] of ['3','8','20'].entries())this.spawnDeparture(stand,['BAW1439','EZY326','RYR6624'][i]);
    this.spawnArrival('KLM927');this.log('Edinburgh Ground. Runway 24 in use.','system');
  }
  log(text,type='info'){this.logs.unshift({time:this.time,text,type});this.logs=this.logs.slice(0,40);}
  spawnDeparture(standId,call){const s=this.stands.get(standId);if(!s||this.planes.some(p=>p.stand===standId&&p.state!=='done'))return;
    const n=this.nodes.get(s.node);const id=this.nextId++;const calls=['BAW1447','EZY604','RYR817','LOG321','SAS2542'];
    this.planes.push({id,call:call||calls[(id-1)%calls.length],type:id%3===0?'B738':'A320',state:'gate',x:n.x,y:n.y,node:s.node,angle:s.heading,stand:standId,route:[],speed:0,direction:'departure',wait:0,held:false,blocked:false});
  }
  spawnArrival(call){const id=this.nextId++,start=this.data.runwayStart,end=this.data.runwayEnd;const length=distance(start,end);const angle=Math.atan2(end.y-start.y,end.x-start.x);
    this.planes.push({id,call:call||['AFR1886','EZY812','BAW1442','KLM931'][(id-1)%4],type:'A320',state:'approach',x:start.x-(end.x-start.x)/length*430,y:start.y-(end.y-start.y)/length*430,angle,node:null,stand:null,route:[],speed:0,direction:'arrival',wait:0,held:false,blocked:false});this.log(`${this.planes.at(-1).call}, inbound runway 24. Request landing.`);
  }
  runwayDistance(n){const a=this.data.runwayStart,b=this.data.runwayEnd,dx=b.x-a.x,dy=b.y-a.y,t=((n.x-a.x)*dx+(n.y-a.y)*dy)/(dx*dx+dy*dy);if(t<-.01||t>1.01)return Infinity;return Math.abs((n.x-a.x)*dy-(n.y-a.y)*dx)/Math.hypot(dx,dy);}
  path(from,to,allowRunway=false){if(!this.nodes.has(from)||!this.nodes.has(to))return [];
    const finder=aStar(this.graph,{distance:(a,b)=>distance(a.data,b.data),heuristic:(a,b)=>distance(a.data,b.data),blocked:(a,b,link)=>{
      if(this.data.stands.some(s=>s.node!==from&&s.node!==to&&(s.node===a.id||s.node===b.id)))return true;
      return !allowRunway&&(this.runwayDistance(a.data)<30||this.runwayDistance(b.data)<30);
    }});
    const result=finder.find(from,to).reverse();
    // Some blocked searches return a goal with no parent; reject incomplete routes.
    return result[0]?.id===from&&result.at(-1)?.id===to?result.map(n=>({...n.data})):[];
  }
  plan(p,destination,waypoints=[]){let from=p.node;let points=[];
    for(const to of [...waypoints,destination]){const part=this.path(from,to);if(!part.length)return [];points.push(...part.slice(points.length?1:0));from=to;}return points;
  }
  routeNames(points){const names=[];for(let i=1;i<points.length;i++){const edge=this.graph.getLink(points[i-1].id,points[i].id)||this.graph.getLink(points[i].id,points[i-1].id);const ref=edge?.data.ref;if(ref&&ref!==names.at(-1)&&edge.data.type!=='parking_position')names.push(ref);}return names;}
  setRoute(p,points,state,speed){p.route=points.map(n=>({...n}));if(p.route.length&&distance(p,p.route[0])<1)p.route.shift();p.state=state;p.targetSpeed=speed;p.held=false;p.blocked=false;p.wait=0;}
  freeStands(){return this.data.stands.filter(s=>!this.planes.some(p=>p.stand===s.id&&p.state!=='done'));}
  command(id,action,{stand,waypoints=[]}={}){const p=this.planes.find(p=>p.id===id);if(!p||this.finished)return {ok:false,message:'No active flight.'};
    const reject=message=>({ok:false,message});
    if(action==='hold'){if(!['pushback','taxi','taxiin','ready','inbound'].includes(p.state))return reject('This flight cannot hold here.');p.held=!p.held;this.log(`${p.call}, ${p.held?'hold position.':'continue.'}`);return {ok:true};}
    if(action==='pushback'){
      if(p.state!=='gate')return reject('Flight is not ready for pushback.');const s=this.stands.get(p.stand);const points=[...s.path].reverse().map(n=>this.nodes.get(n));this.setRoute(p,points,'pushback',2.6);this.log(`${p.call}, pushback approved, stand ${s.id}.`);return {ok:true};
    }
    if(action==='taxi'){
      if(!['ready','inbound'].includes(p.state)&&!(['taxi','taxiin'].includes(p.state)&&p.held))return reject('Stop the aircraft before revising its clearance.');
      const arriving=p.direction==='arrival';let target=this.data.departureHold;
      if(arriving){const s=this.stands.get(stand);if(!s)return reject('Choose a stand.');if(this.planes.some(q=>q.id!==p.id&&q.stand===stand&&q.state!=='done'))return reject('That stand is occupied or reserved.');target=s.node;}
      const points=this.plan(p,target,waypoints);if(points.length<2)return reject('No clear taxi route to that destination.');
      if(arriving)p.stand=stand;this.setRoute(p,points,arriving?'taxiin':'taxi',8);p.destination=target;p.clearance=this.routeNames(points).join(' - ');this.log(`${p.call}, taxi ${arriving?'stand '+stand:'holding point D1, runway 24'} via ${p.clearance||'apron'}.`);return {ok:true};
    }
    if(action==='lineup'){
      if(p.state!=='holding')return reject('Taxi to holding point D1 first.');if(this.runwayOwner)return reject('Runway occupied. Hold short.');
      const points=this.path(p.node,this.data.departureEntry,true);if(!points.length)return reject('Runway entry unavailable.');this.runwayOwner=p.id;
      this.setRoute(p,points,'lineup',6);this.log(`${p.call}, line up and wait runway 24.`);return {ok:true};
    }
    if(action==='takeoff'){
      if(p.state!=='linedup'||this.runwayOwner!==p.id)return reject('Line up on runway 24 first.');const end=this.data.runwayEnd;
      this.setRoute(p,[end,{x:end.x+(end.x-this.data.runwayStart.x)*.25,y:end.y+(end.y-this.data.runwayStart.y)*.25}],'takeoff',78);this.log(`${p.call}, cleared for takeoff runway 24.`);return {ok:true};
    }
    if(action==='land'){
      if(p.state!=='approach')return reject('Aircraft is not on approach.');if(this.runwayOwner)return reject('Runway occupied. Landing clearance unavailable.');
      const exit=this.nodes.get(this.data.arrivalExit);const toApron=this.path(exit.id,this.data.stands[0].exit,true);const safe=toApron.findIndex(n=>this.runwayDistance(n)>85);
      if(safe<0)return reject('No safe runway exit.');this.runwayOwner=p.id;p.landingExit=exit.id;
      this.setRoute(p,[this.data.runwayStart,exit,...toApron.slice(1,safe+1)],'landing',65);this.log(`${p.call}, cleared to land runway 24.`);return {ok:true};
    }
    if(action==='goaround'){
      if(p.state!=='approach')return reject('Only inbound flights can go around.');p.wait=0;this.score-=25;this.log(`${p.call}, go around. Rejoining the arrival queue. -25`, 'warning');return {ok:true};
    }
    return reject('Unknown clearance.');
  }
  arrive(p){p.speed=0;p.route=[];
    if(p.state==='pushback'){p.state='ready';p.stand=null;this.log(`${p.call}, pushback complete. Request taxi.`);}
    else if(p.state==='taxi'){p.state='holding';this.log(`${p.call}, holding short D1.`);}
    else if(p.state==='lineup'){p.state='linedup';p.angle=Math.atan2(this.data.runwayEnd.y-p.y,this.data.runwayEnd.x-p.x);}
    else if(p.state==='takeoff'){p.state='done';this.runwayOwner=null;this.completed++;this.score+=100;this.log(`${p.call}, airborne. Handoff complete. +100`,'success');}
    else if(p.state==='landing'){p.state='inbound';this.runwayOwner=null;this.log(`${p.call}, runway vacated. Request stand.`);}
    else if(p.state==='taxiin'){p.state='parked';p.parkedAt=this.time;this.completed++;this.score+=100;this.log(`${p.call}, on stand ${p.stand}. +100`,'success');}
  }
  tick(dt){if(this.finished)return;dt=Math.min(dt,0.25);this.time+=dt;
    if(this.time>=1200){this.finished=true;this.log('Shift complete.','success');return;}
    if(this.time>this.nextArrival){if(this.planes.filter(p=>p.state==='approach').length<2)this.spawnArrival();this.nextArrival+=210;}
    if(this.time>this.nextDeparture){const free=this.freeStands().filter(s=>+s.id<25);if(free.length&&this.planes.filter(p=>p.direction==='departure'&&p.state!=='done').length<6)this.spawnDeparture(free[Math.floor(this.nextDeparture/260)%free.length].id);this.nextDeparture+=260;}
    const active=this.planes.filter(p=>!['done','approach'].includes(p.state));
    for(const p of this.planes){p.wait+=dt;p.blocked=false;
      if(p.state==='approach'){if(p.wait>210){this.command(p.id,'goaround');this.incidents++;}continue;}
      if(p.state==='parked'&&this.time-p.parkedAt>100){p.state='gate';p.direction='departure';this.log(`${p.call}, turnaround complete. Request pushback.`);}
      if(p.held||!p.route.length){p.speed=0;continue;}
      const next=p.route[0];let target=p.targetSpeed;
      if(p.state==='landing'){if(p.node===p.landingExit)p.vacating=true;if(p.vacating)target=8;else if(distance(p,this.nodes.get(p.landingExit))<300)target=25;}
      if(p.state==='takeoff')p.speed=Math.min(target,(p.speed||6)+2.5*dt);else p.speed=Math.min(target,(p.speed||0)+3*dt);
      const angle=Math.atan2(next.y-p.y,next.x-p.x);
      if(p.state!=='takeoff'&&(p.state!=='landing'||p.vacating)){
        const obstacle=active.find(q=>q.id!==p.id&&distance(p,q)<55&&((q.x-p.x)*Math.cos(angle)+(q.y-p.y)*Math.sin(angle))>0&&Math.abs((q.x-p.x)*Math.sin(angle)-(q.y-p.y)*Math.cos(angle))<26);
        if(obstacle){p.blocked=true;p.speed=0;const pair=[p.id,obstacle.id].sort().join(':');if(!this.conflictPairs.has(pair)){this.conflictPairs.add(pair);this.incidents++;this.score-=20;this.log(`${p.call}, traffic ahead: ${obstacle.call}. Hold position. -20`,'warning');}continue;}
      }
      let remaining=p.speed*dt;
      while(remaining>0&&p.route.length){const n=p.route[0],length=distance(p,n);if(length>0){const heading=Math.atan2(n.y-p.y,n.x-p.x);const desired=p.state==='pushback'?heading+Math.PI:heading;let delta=Math.atan2(Math.sin(desired-p.angle),Math.cos(desired-p.angle));p.angle+=Math.max(-dt*1.5,Math.min(dt*1.5,delta));}
        if(remaining>=length){p.x=n.x;p.y=n.y;p.node=n.id||null;remaining-=length;p.route.shift();if(p.state==='landing'&&p.node===p.landingExit){p.vacating=true;p.speed=8;remaining=0;}}else{p.x+=(n.x-p.x)/length*remaining;p.y+=(n.y-p.y)/length*remaining;remaining=0;}}
      if(!p.route.length)this.arrive(p);
    }
  }
}
