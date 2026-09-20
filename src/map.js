import { distance } from './sim.js';
export class AirportMap {
  constructor(canvas,sim,onSelect,onWaypoint){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.sim=sim;this.selected=1;this.preview=[];this.waypoints=[];this.labels=true;this.camera={x:0,y:0,zoom:1};this.onSelect=onSelect;this.onWaypoint=onWaypoint;this.pointers=new Map();
    new ResizeObserver(()=>this.resize()).observe(canvas);this.bind();this.resize();
  }
  resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;const dpr=window.devicePixelRatio||1;this.canvas.width=r.width*dpr;this.canvas.height=r.height*dpr;this.ctx.setTransform(dpr,0,0,dpr,0,0);if(!this.initialized){this.fit();this.initialized=true;}this.draw();}
  fit(){this.camera={x:70,y:-65,zoom:Math.min(this.width/3400,(this.height-115)/1900)};}
  screen(n){return{x:(n.x-this.camera.x)*this.camera.zoom+this.width/2,y:(n.y-this.camera.y)*this.camera.zoom+this.height/2};}
  world(x,y){return{x:(x-this.width/2)/this.camera.zoom+this.camera.x,y:(y-this.height/2)/this.camera.zoom+this.camera.y};}
  zoom(factor,x=this.width/2,y=this.height/2){const old=this.world(x,y);this.camera.zoom=Math.max(.1,Math.min(3,this.camera.zoom*factor));const now=this.world(x,y);this.camera.x+=old.x-now.x;this.camera.y+=old.y-now.y;}
  bind(){const c=this.canvas;
    c.addEventListener('wheel',e=>{e.preventDefault();const r=c.getBoundingClientRect();this.zoom(Math.exp(-e.deltaY*.001),e.clientX-r.left,e.clientY-r.top);},{passive:false});
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.drag={x:e.clientX,y:e.clientY,moved:false};});
    c.addEventListener('pointermove',e=>{if(!this.pointers.has(e.pointerId))return;const prev=this.pointers.get(e.pointerId);const next={x:e.clientX,y:e.clientY};
      if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==e.pointerId)[1];const before=distance(prev,other),after=distance(next,other);if(before>0)this.zoom(after/before);this.drag.moved=true;}else{const dx=next.x-prev.x,dy=next.y-prev.y;this.camera.x-=dx/this.camera.zoom;this.camera.y-=dy/this.camera.zoom;if(Math.hypot(e.clientX-this.drag.x,e.clientY-this.drag.y)>4)this.drag.moved=true;}this.pointers.set(e.pointerId,next);});
    c.addEventListener('pointerup',e=>{this.pointers.delete(e.pointerId);if(!this.drag?.moved&&this.pointers.size===0){const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const plane=this.sim.planes.filter(p=>p.state!=='done').sort((a,b)=>distance(this.screen(a),{x,y})-distance(this.screen(b),{x,y}))[0];if(plane&&distance(this.screen(plane),{x,y})<23){this.onSelect(plane.id);return;}
        const p=this.world(x,y);const nearest=this.sim.data.nodes.filter(n=>this.sim.runwayDistance(n)>30).sort((a,b)=>distance(a,p)-distance(b,p))[0];if(nearest&&distance(nearest,p)*this.camera.zoom<24)this.onWaypoint(nearest.id);}});
    c.addEventListener('pointercancel',e=>this.pointers.delete(e.pointerId));
    c.addEventListener('keydown',e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')this.fit();else this.zoom(e.key==='-'?.8:1.25);}});
  }
  line(points,color,width,dash=[]){if(points.length<2)return;const c=this.ctx;c.beginPath();for(const [i,point] of points.entries()){const p=this.screen(Array.isArray(point)?{x:point[0],y:point[1]}:point);if(i===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);}c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.stroke();c.setLineDash([]);}
  polygon(points,fill,stroke){const c=this.ctx;c.beginPath();points.forEach((point,i)=>{const p=this.screen({x:point[0],y:point[1]});if(!i)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);});c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
  label(text,x,y,color='#d3decb',size=10,bg){const c=this.ctx;c.font=`${size}px ui-monospace, monospace`;c.textAlign='center';if(bg){const w=c.measureText(text).width;c.fillStyle=bg;c.fillRect(x-w/2-5,y-size, w+10,size+6);}c.fillStyle=color;c.fillText(text,x,y);}
  draw(){const c=this.ctx,z=this.camera.zoom;c.clearRect(0,0,this.width,this.height);c.fillStyle='#293d32';c.fillRect(0,0,this.width,this.height);c.lineJoin='round';c.lineCap='round';
    const grid=250;const tl=this.world(0,0),br=this.world(this.width,this.height);for(let x=Math.floor(tl.x/grid)*grid;x<br.x;x+=grid)this.line([{x,y:tl.y},{x,y:br.y}],'#3e53433b',.6);for(let y=Math.floor(tl.y/grid)*grid;y<br.y;y+=grid)this.line([{x:tl.x,y},{x:br.x,y}],'#3e53433b',.6);
    const fs=this.sim.data.features;
    for(const f of fs)if(f.type==='aerodrome')this.polygon(f.points,'#334a39','#50664a');
    for(const f of fs)if(f.type==='road')this.line(f.points,'#60706555',Math.max(1,5*z));
    for(const f of fs)if(f.type==='apron')this.polygon(f.points,'#626e66','#899488');
    for(const f of fs)if(['taxiway','taxilane'].includes(f.type)){this.line(f.points,'#9aa294',Math.max(3,26*z));this.line(f.points,'#727c72',Math.max(2,23*z));}
    for(const f of fs)if(['runway','stopway'].includes(f.type)){this.line(f.points,'#92998a',Math.max(10,48*z));this.line(f.points,'#38413d',Math.max(8,44*z));}
    for(const f of fs)if(f.type==='runway')this.line(f.points,'#cbd0b9',Math.max(.7,1.5*z),[Math.max(3,27*z),Math.max(3,21*z)]);
    for(const f of fs)if(['taxiway','taxilane'].includes(f.type))this.line(f.points,'#d5c466',Math.max(.65,1.2*z));
    for(const f of fs)if(f.type==='parking_position')this.line(f.points,'#c6b867',Math.max(.55,z),[3,3]);
    for(const f of fs)if(['building','terminal','tower'].includes(f.type)&&f.closed){const airport= f.type==='terminal'||f.type==='tower';this.polygon(f.points,airport?'#b9c5ba':'#68796c',airport?'#d1d7c5':'#8b9a8755');}
    const start=this.sim.data.runwayStart,end=this.sim.data.runwayEnd;const heading=Math.atan2(end.y-start.y,end.x-start.x);
    for(const [i,n] of [start,end].entries()){const p=this.screen(n);c.save();c.translate(p.x,p.y);c.rotate(heading+(i?Math.PI:0));c.fillStyle='#e8e9d9';c.font=`bold ${Math.max(10,28*z)}px sans-serif`;c.textAlign='center';c.fillText(i?'06':'24',i?0:0,-5);for(let k=-3;k<=3;k++)if(k!==0)c.fillRect(25*z,k*5*z,30*z,2.5*z);c.restore();}
    const occupied=this.sim.runwayOwner;if(occupied)this.line([start,end],'#efb76155',Math.max(10,45*z));
    if(this.labels){const placed=[];for(const f of fs){if(f.type!=='taxiway'||!f.ref)continue;const point=f.points[Math.floor(f.points.length/2)],p=this.screen({x:point[0],y:point[1]});if(placed.some(n=>distance(n,p)<45))continue;placed.push(p);this.label(f.ref,p.x,p.y-5,'#e7d883',9,'#35463bed');}
      const selectedStand=this.sim.planes.find(q=>q.id===this.selected)?.stand;
      for(const s of this.sim.data.stands){if(z<.2&&s.id!==selectedStand)continue;if(z>=.2&&z<.4&&+s.id%2!==0)continue;const p=this.screen(this.sim.nodes.get(s.node));const busy=this.sim.planes.some(q=>q.stand===s.id&&q.state!=='done');this.label(s.id,p.x,p.y+15,busy?'#ecd179':'#cbd5c4',Math.max(8,Math.min(12,15*z)));}
      if(z>=.2){const t=this.screen({x:550,y:270});this.label('TERMINAL',t.x,t.y,'#bccbb7',10);}const a=this.screen({x:-650,y:-100});this.label('RWY 06 / 24',a.x,a.y,'#85997d',10);
    }
    const hold=this.screen(this.sim.nodes.get(this.sim.data.departureHold));c.strokeStyle='#f9c55d';c.lineWidth=3;c.beginPath();c.moveTo(hold.x-5,hold.y-3);c.lineTo(hold.x+5,hold.y+3);c.stroke();this.label('D1',hold.x+12,hold.y+17,'#f1d47a',10,'#293e31');
    for(const p of this.sim.planes)if(p.route.length)this.line([p,...p.route],p.id===this.selected?'#85f0cf':'#8bd4ae70',p.id===this.selected?2.4:1.2,[6,5]);
    if(this.preview.length){this.line(this.preview,'#a5f6df',3);this.line(this.preview,'#1f9679',1,[5,6]);}
    for(const [i,id] of this.waypoints.entries()){const p=this.screen(this.sim.nodes.get(id));c.beginPath();c.arc(p.x,p.y,8,0,Math.PI*2);c.fillStyle='#a5f6df';c.fill();this.label(String(i+1),p.x,p.y+3,'#1e4b3c',10);}
    const labels=[];for(const p of this.sim.planes.filter(p=>p.state!=='done').sort((a,b)=>(b.id===this.selected)-(a.id===this.selected))){const s=this.screen(p);if(s.x< -100||s.x>this.width+100||s.y< -100||s.y>this.height+100)continue;const selected=p.id===this.selected;const color=p.blocked?'#f38f75':p.direction==='arrival'?'#c2c4ff':'#f4d672';
      if(selected){c.beginPath();c.arc(s.x,s.y,18,0,Math.PI*2);c.fillStyle='#132e2366';c.fill();c.strokeStyle='#c6ead6aa';c.lineWidth=1;c.stroke();}
      c.save();c.translate(s.x,s.y);c.rotate(p.angle);c.fillStyle=color;c.strokeStyle='#243a30';c.lineWidth=1.3;c.beginPath();c.moveTo(12,0);c.quadraticCurveTo(10,-2,3,-2);c.lineTo(-3,-11);c.lineTo(-6,-11);c.lineTo(-3,-2);c.lineTo(-9,-2);c.lineTo(-12,-5);c.lineTo(-14,-5);c.lineTo(-12,0);c.lineTo(-14,5);c.lineTo(-12,5);c.lineTo(-9,2);c.lineTo(-3,2);c.lineTo(-6,11);c.lineTo(-3,11);c.lineTo(3,2);c.quadraticCurveTo(10,2,12,0);c.closePath();c.fill();c.stroke();c.restore();
      let y=s.y-25;let tries=0;while(labels.some(l=>Math.abs(l.x-s.x)<85&&Math.abs(l.y-y)<28)&&tries++<5)y-=28;if(s.x>this.width-175&&y<100)y=s.y+30;labels.push({x:s.x,y});this.label(p.call,s.x,y,color,10,selected?'#182e25f0':'#223b2ee8');if(selected&&z>.2)this.label(p.blocked?'TRAFFIC HOLD':`${Math.round(p.speed*1.944)} KT`,s.x,y-14,'#bcd0c4',8);
    }
  }
}
