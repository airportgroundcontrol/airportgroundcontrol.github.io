import createGraph from 'ngraph.graph';
import { aStar } from 'ngraph.path';
import { separation, distanceAhead, routeConflict, targetCleared } from './traffic.js';

export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const statusNames={gate:'Request pushback',pushback:'Pushing back',ready:'Request taxi',taxi:'Taxiing out',holding:'Request runway entry',lineup:'Lining up',linedup:'Request takeoff',takeoff:'Taking off',approach:'Request landing',landing:'Landing / vacating',inbound:'Request stand',taxiin:'Taxiing to stand',atpoint:'Request onward taxi',parked:'On stand',done:'Departed'};
export const requestsAction=p=>p.state!=='done'&&(['gate','ready','holding','linedup','approach','inbound','atpoint'].includes(p.state)||p.held||p.blocked);
export const orderedFlights=planes=>planes.filter(p=>p.state!=='done').sort((a,b)=>Number(requestsAction(b))-Number(requestsAction(a))||b.wait-a.wait||a.id-b.id);
export const flightStatus=p=>p.blocked?'Traffic conflict':p.holdReached?'Request onward clearance':p.held?'Holding position':p.trafficWaiting?'Giving way':p.trafficOrder?.kind==='follow'?'Following traffic':statusNames[p.state];
export function groupedFlights(planes) {
  const groups = new Map();
  for (const p of orderedFlights(planes)) {
    const label = flightStatus(p), key = (requestsAction(p) ? 'request:' : 'status:') + label;
    if (!groups.has(key)) groups.set(key, { key, label, request: requestsAction(p), planes: [] });
    groups.get(key).planes.push(p);
  }
  return [...groups.values()];
}
export class GroundSim {
  constructor(data){
    this.data=data;this.nodes=new Map(data.nodes.map(n=>[n.id,n]));this.stands=new Map(data.stands.map(s=>[s.id,s]));
    this.graph=createGraph();for(const n of data.nodes)this.graph.addNode(n.id,n);for(const e of data.edges)this.graph.addLink(e.a,e.b,e);
    this.reset();
  }
  reset(){this.time=0;this.score=0;this.completed=0;this.incidents=0;this.planes=[];this.logs=[];this.nextId=1;this.runwayOwner=null;this.nextArrival=210;this.nextDeparture=260;this.nextCleanup=60;this.conflictPairs=new Set();
    for(const [i,stand] of ['3','8','20'].entries())this.spawnDeparture(stand,['BAW1439','EZY326','RYR6624'][i]);
    this.spawnArrival('KLM927');this.log('Edinburgh Ground. Runway 24 in use.','system');
  }
  log(text,type='info'){this.logs.unshift({time:this.time,text,type});this.logs=this.logs.slice(0,40);}
  callsign(prefix,id){let number=1000+id%8900;while(this.planes.some(p=>p.state!=='done'&&p.call===prefix+number))number++;return prefix+number;}
  spawnDeparture(standId,call){const s=this.stands.get(standId);if(!s||this.planes.some(p=>p.stand===standId&&p.state!=='done'))return;
    const n=this.nodes.get(s.node);const id=this.nextId++;const calls=['BAW','EZY','RYR','LOG','SAS'];
    this.planes.push({id,call:call||this.callsign(calls[(id-1)%calls.length],id),type:id%3===0?'B738':'A320',state:'gate',x:n.x,y:n.y,node:s.node,angle:s.heading,stand:standId,route:[],speed:0,direction:'departure',wait:0,held:false,blocked:false});
  }
  spawnArrival(call){const id=this.nextId++,start=this.data.runwayStart,end=this.data.runwayEnd;const length=distance(start,end);const angle=Math.atan2(end.y-start.y,end.x-start.x);
    const spacing=430+this.planes.filter(p=>p.state==='approach').length*220;
    this.planes.push({id,call:call||this.callsign(['AFR','EZY','BAW','KLM'][(id-1)%4],id),type:'A320',state:'approach',x:start.x-(end.x-start.x)/length*spacing,y:start.y-(end.y-start.y)/length*spacing,angle,node:null,stand:null,route:[],speed:0,direction:'arrival',wait:0,held:false,blocked:false});this.log(`${this.planes.at(-1).call}, inbound runway 24. Request landing.`);
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
  plan(p,destination,waypoints=[]){const between=p.route.length&&distance(p,this.nodes.get(p.node)||p)>.1;let from=between?p.route[0].id:p.node;let points=[];
    for(const to of [...waypoints,destination]){const part=this.path(from,to);if(!part.length)return [];points.push(...part.slice(points.length?1:0));from=to;}return between?[{x:p.x,y:p.y},...points]:points;
  }
  routeNames(points){const names=[];for(let i=1;i<points.length;i++){const edge=this.graph.getLink(points[i-1].id,points[i].id)||this.graph.getLink(points[i].id,points[i-1].id);const ref=edge?.data.ref;if(ref&&ref!==names.at(-1)&&edge.data.type!=='parking_position')names.push(ref);}return names;}
  setRoute(p,points,state,speed){p.route=points.map(n=>({...n}));if(p.route.length&&distance(p,p.route[0])<1)p.route.shift();p.state=state;p.targetSpeed=speed;p.held=false;p.blocked=false;p.wait=0;}
  holdingPoints(){return this.data.nodes.filter(n=>n.hold&&n.ref&&this.runwayDistance(n)>=30).sort((a,b)=>a.ref.localeCompare(b.ref,undefined,{numeric:true}));}
  edgeRef(a,b){return (this.graph.getLink(a,b)||this.graph.getLink(b,a))?.data.ref;}
  holdOptions(p){
    if(!['taxi','taxiin'].includes(p.state))return [];
    const options=[];let previous=p,along=0,lastRef='';
    for(let i=0;i<p.route.length;i++){
      const n=p.route[i];along+=distance(previous,n);
      if(n.hold&&n.ref&&along>5)options.push({id:'point:'+n.id,label:n.ref,distance:along,node:n});
      const incoming=this.edgeRef(previous===p?p.node:previous.id,n.id)||lastRef;
      const next=p.route[i+1],outgoing=next&&(this.graph.getLink(n.id,next.id)||this.graph.getLink(next.id,n.id))?.data;
      if(incoming&&outgoing?.ref&&incoming!==outgoing.ref&&along>separation+5&&['taxiway','taxilane'].includes(outgoing.type))options.push({id:'taxiway:'+n.id,label:'Taxiway '+outgoing.ref,distance:along-separation,node:n});
      lastRef=incoming;
      previous=n;
    }
    return options.sort((a,b)=>a.distance-b.distance);
  }
  trafficCandidates(p,kind){
    if(!['taxi','taxiin'].includes(p.state)||!p.route.length)return [];
    return this.planes.filter(q=>q.id!==p.id&&['taxi','taxiin','pushback'].includes(q.state)&&q.route.length).filter(q=>{
      const conflict=routeConflict(p,q,{aligned:kind==='follow'});
      return conflict&&conflict.distanceA>=separation&&!this.trafficCycle(p,q);
    });
  }
  trafficCycle(p,q){const seen=new Set([p.id]);while(q){if(seen.has(q.id))return true;seen.add(q.id);q=this.planes.find(n=>n.id===q.trafficOrder?.targetId);}return false;}
  freeStands(){return this.data.stands.filter(s=>!this.planes.some(p=>p.stand===s.id&&p.state!=='done'));}
  command(id,action,{stand,waypoints=[],holdingPoint,holdPoint,targetId}={}){const p=this.planes.find(p=>p.id===id);if(!p||p.state==='done')return {ok:false,message:'No active flight.'};
    const reject=message=>({ok:false,message});
    if(action==='continue'){
      if(!p.holdReached||!p.route.length)return reject('A new taxi clearance is required.');
      p.holdLimit=null;p.holdReached=false;p.held=false;p.wait=0;this.log(`${p.call}, continue taxi.`);return {ok:true};
    }
    if(action==='hold'){if(!['pushback','taxi','taxiin','ready','inbound'].includes(p.state)||p.holdReached)return reject('Use onward clearance to leave the holding point.');p.held=!p.held;this.log(`${p.call}, ${p.held?'hold position.':'continue.'}`);return {ok:true};}
    if(action==='holdshort'){
      if(p.holdReached)return reject('Issue onward clearance first.');
      const limit=this.holdOptions(p).find(h=>h.id===holdPoint);
      if(!limit)return reject('Choose a holding point or taxiway ahead on this route.');
      p.holdLimit={...limit,stopAt:(p.travelled||0)+limit.distance};
      this.log(`${p.call}, hold short of ${limit.label}.`);return {ok:true};
    }
    if(action==='follow'||action==='giveway'){
      const q=this.trafficCandidates(p,action).find(q=>q.id===targetId);
      if(!q)return reject('Choose compatible traffic ahead. Conflicting or circular instructions are unavailable.');
      const conflict=routeConflict(p,q,{aligned:action==='follow'});
      p.trafficOrder={kind:action,targetId:q.id,point:conflict.point,stopAt:(p.travelled||0)+conflict.distanceA-separation,releaseAt:(q.travelled||0)+conflict.distanceB+separation,merged:false};
      this.log(`${p.call}, ${action==='follow'?'follow':'give way to'} ${q.call}.`);return {ok:true};
    }
    if(action==='canceltraffic'){
      if(!p.trafficOrder)return reject('No traffic instruction is active.');
      p.trafficOrder=null;p.trafficWaiting=null;this.log(`${p.call}, traffic instruction cancelled. Maintain separation.`);return {ok:true};
    }
    if(action==='pushback'){
      if(p.state!=='gate')return reject('Flight is not ready for pushback.');const s=this.stands.get(p.stand);const points=[...s.path].reverse().map(n=>this.nodes.get(n));this.setRoute(p,points,'pushback',2.6);this.log(`${p.call}, pushback approved, stand ${s.id}.`);return {ok:true};
    }
    if(action==='taxi'){
      if(!['ready','inbound','atpoint','holding'].includes(p.state)&&!(['taxi','taxiin'].includes(p.state)&&p.held))return reject('Stop the aircraft before revising its clearance.');
      const arriving=p.direction==='arrival';let target=this.data.departureHold;
      if(holdingPoint){const h=this.holdingPoints().find(n=>n.id===holdingPoint);if(!h)return reject('Choose a mapped holding point.');target=h.id;}
      else if(arriving){const s=this.stands.get(stand);if(!s)return reject('Choose a stand.');if(this.planes.some(q=>q.id!==p.id&&q.stand===stand&&q.state!=='done'))return reject('That stand is occupied or reserved.');target=s.node;}
      const points=this.plan(p,target,waypoints);if(points.length<2)return reject('No clear taxi route to that destination.');
      if(arriving&&!holdingPoint)p.stand=stand;
      p.taxiTarget=holdingPoint?'hold':arriving?'stand':'runway';p.holdLabel=holdingPoint?this.nodes.get(holdingPoint).ref:null;
      p.holdLimit=null;p.holdReached=false;p.trafficOrder=null;p.trafficWaiting=null;
      this.setRoute(p,points,arriving?'taxiin':'taxi',8);p.destination=target;p.clearance=this.routeNames(points).join(' - ');this.log(`${p.call}, taxi ${holdingPoint?'holding point '+p.holdLabel:arriving?'stand '+stand:'holding point D1, runway 24'} via ${p.clearance||'apron'}.`);return {ok:true};
    }
    if(action==='lineup'){
      if(p.state!=='holding'||p.node!==this.data.departureHold||p.direction!=='departure')return reject('Taxi to holding point D1 first.');if(this.runwayOwner)return reject('Runway occupied. Hold short.');
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
    p.trafficOrder=null;p.trafficWaiting=null;p.holdLimit=null;p.holdReached=false;p.wait=0;
    if(['taxi','taxiin'].includes(p.state)&&p.taxiTarget==='hold'&&(p.destination!==this.data.departureHold||p.direction==='arrival')){p.state='atpoint';this.log(`${p.call}, holding at ${p.holdLabel}. Request onward taxi.`);return;}
    if(p.state==='pushback'){p.state='ready';p.stand=null;this.log(`${p.call}, pushback complete. Request taxi.`);}
    else if(p.state==='taxi'){p.state='holding';this.log(`${p.call}, holding short D1.`);}
    else if(p.state==='lineup'){p.state='linedup';p.angle=Math.atan2(this.data.runwayEnd.y-p.y,this.data.runwayEnd.x-p.x);}
    else if(p.state==='takeoff'){p.state='done';p.completedAt=this.time;this.runwayOwner=null;this.completed++;this.score+=100;this.log(`${p.call}, airborne. Handoff complete. +100`,'success');}
    else if(p.state==='landing'){p.state='inbound';this.runwayOwner=null;this.log(`${p.call}, runway vacated. Request stand.`);}
    else if(p.state==='taxiin'){p.state='parked';p.parkedAt=this.time;this.completed++;this.score+=100;this.log(`${p.call}, on stand ${p.stand}. +100`,'success');}
  }
  tick(dt){dt=Math.min(dt,0.25);this.time+=dt;
    if(this.time>=this.nextCleanup){this.planes=this.planes.filter(p=>p.state!=='done'||this.time-p.completedAt<60);const ids=new Set(this.planes.map(p=>p.id));for(const pair of this.conflictPairs)if(pair.split(':').some(id=>!ids.has(+id)))this.conflictPairs.delete(pair);this.nextCleanup=this.time+60;}
    if(this.time>this.nextArrival){if(this.planes.filter(p=>p.state==='approach').length<2&&this.planes.filter(p=>p.state!=='done').length<24)this.spawnArrival();this.nextArrival+=210;}
    if(this.time>this.nextDeparture){const free=this.freeStands().filter(s=>+s.id<25);if(free.length&&this.planes.filter(p=>p.direction==='departure'&&p.state!=='done').length<6)this.spawnDeparture(free[Math.floor(this.nextDeparture/260)%free.length].id);this.nextDeparture+=260;}
    const active=this.planes.filter(p=>!['done','approach'].includes(p.state));
    for(const p of this.planes){p.wait+=dt;p.blocked=false;p.trafficWaiting=null;
      if(p.state==='approach'){if(p.wait>210){this.command(p.id,'goaround');this.incidents++;}continue;}
      if(p.state==='parked'&&this.time-p.parkedAt>100){p.state='gate';p.direction='departure';this.log(`${p.call}, turnaround complete. Request pushback.`);}
      if(p.held||!p.route.length){p.speed=0;continue;}
      const next=p.route[0];let target=p.targetSpeed,allowance=Infinity;
      if(p.holdLimit)allowance=Math.max(0,p.holdLimit.stopAt-(p.travelled||0));
      if(p.trafficOrder){
        const order=p.trafficOrder,q=this.planes.find(q=>q.id===order.targetId);
        if(!order.merged&&targetCleared(order,q)){
          if(order.kind==='giveway'){p.trafficOrder=null;this.log(`${p.call}, traffic clear. Continuing taxi.`);}
          else order.merged=true;
        }
        if(p.trafficOrder&&!order.merged){
          const available=Math.max(0,order.stopAt-(p.travelled||0));allowance=Math.min(allowance,available);
          if(available<2)p.trafficWaiting=order.kind;
        }
        if(order.kind==='follow'&&order.merged&&(!q||q.state==='done'||(!routeConflict(p,q,{aligned:true})&&distanceAhead(p,q,24,Infinity)===Infinity)))p.trafficOrder=null;
      }
      if(p.state==='landing'){if(p.node===p.landingExit)p.vacating=true;if(p.vacating)target=8;else if(distance(p,this.nodes.get(p.landingExit))<300)target=25;}
      const angle=Math.atan2(next.y-p.y,next.x-p.x);
      if(p.state!=='takeoff'&&(p.state!=='landing'||p.vacating)){
        for(const q of active){
          if(q.id===p.id)continue;
          let ahead=distanceAhead(p,q);
          // Also protect short route ends where a nearby fuselage sits just beyond the final node.
          const forward=(q.x-p.x)*Math.cos(angle)+(q.y-p.y)*Math.sin(angle);
          if(forward>0&&distance(p,q)<55&&Math.abs((q.x-p.x)*Math.sin(angle)-(q.y-p.y)*Math.cos(angle))<26)ahead=Math.min(ahead,forward);
          if(ahead<130){
            allowance=Math.min(allowance,Math.max(0,ahead-separation));
            if(ahead<separation+2){
              const orderly=p.trafficOrder?.targetId===q.id||(['taxi','taxiin','holding','atpoint','lineup','linedup'].includes(q.state)&&Math.cos((q.route[0]?Math.atan2(q.route[0].y-q.y,q.route[0].x-q.x):q.angle)-angle)>-.3);
              if(orderly)p.trafficWaiting='spacing';
              else {p.blocked=true;const pair=[p.id,q.id].sort().join(':');if(!this.conflictPairs.has(pair)){this.conflictPairs.add(pair);this.incidents++;this.score-=20;this.log(`${p.call}, conflicting traffic: ${q.call}. Hold position. -20`,'warning');}}
            }
          }
          if(!['taxi','taxiin'].includes(p.state)||!q.route.length||q.trafficOrder?.targetId===p.id)continue;
          const crossing=routeConflict(p,q,{horizon:150});
          if(!crossing||Math.abs(crossing.alignment)>.85)continue;
          const otherOnRight=crossing.heading.x*(q.y-p.y)-crossing.heading.y*(q.x-p.x)>0;
          if((otherOnRight||q.state==='landing')&&!(crossing.distanceA<separation&&crossing.distanceB>separation)){
            const available=Math.max(0,crossing.distanceA-separation);allowance=Math.min(allowance,available);
            if(available<2)p.trafficWaiting='right-of-way';
          }
        }
      }
      target=Math.min(target,allowance<2?allowance:Math.max(1,allowance/2));
      if(p.state==='takeoff')p.speed=Math.min(target,(p.speed||6)+2.5*dt);else p.speed=Math.min(target,(p.speed||0)+3*dt);
      let remaining=Math.min(p.speed*dt,allowance);
      if(allowance<.05){remaining=0;p.speed=0;}
      while(remaining>0&&p.route.length){const n=p.route[0],length=distance(p,n);if(length>0){const heading=Math.atan2(n.y-p.y,n.x-p.x);const desired=p.state==='pushback'?heading+Math.PI:heading;let delta=Math.atan2(Math.sin(desired-p.angle),Math.cos(desired-p.angle));p.angle+=Math.max(-dt*1.5,Math.min(dt*1.5,delta));}
        p.travelled=(p.travelled||0)+Math.min(remaining,length);
        if(remaining>=length){p.x=n.x;p.y=n.y;p.node=n.id||null;remaining-=length;p.route.shift();if(p.state==='landing'&&p.node===p.landingExit){p.vacating=true;p.speed=8;remaining=0;}}else{p.x+=(n.x-p.x)/length*remaining;p.y+=(n.y-p.y)/length*remaining;remaining=0;}}
      if(p.holdLimit&&p.route.length&&p.holdLimit.stopAt-(p.travelled||0)<.05){p.held=true;p.holdReached=true;p.speed=0;p.wait=0;this.log(`${p.call}, holding short of ${p.holdLimit.label}. Request onward clearance.`);}
      if(!p.route.length)this.arrive(p);
    }
  }
}
