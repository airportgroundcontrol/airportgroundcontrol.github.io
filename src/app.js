import { createIcons, Plane, ChevronDown, Pause, Play, RotateCcw, Sun, Plus, Minus, Scan, Tags, Navigation2, X, Check, Download, CornerDownLeft, PlaneLanding, Undo2, ArrowUpRight, PlaneTakeoff, Route, Keyboard, PanelRight } from 'lucide';
import airportData from '../dist/data/egph.json';
import { GroundSim, flightStatus, requestsAction, orderedFlights, groupedFlights } from './sim.js';
import { AirportMap } from './map.js';

const $ = id => document.getElementById(id);
const icon = name => '<i data-lucide="' + name + '"></i>';
const icons = { Plane, ChevronDown, Pause, Play, RotateCcw, Sun, Plus, Minus, Scan, Tags, Navigation2, X, Check, Download, CornerDownLeft, PlaneLanding, Undo2, ArrowUpRight, PlaneTakeoff, Route, Keyboard, PanelRight };
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
const formatTime = t => new Date((8 * 3600 + Math.floor(t)) * 1000).toISOString().slice(11, 19);
const shortcuts = { p: 'pushback', t: 'preview', h: 'hold', l: 'land', u: 'lineup', d: 'takeoff', g: 'goaround', b: 'holdingpoint', s: 'holdshort', y: 'follow', w: 'giveway', c: 'continue', x: 'canceltraffic', Enter: 'taxi' };
let sim, map, selected = 1, speed = 4, paused = false, filter = 'all';
let planning = false, waypoints = [], destination = '', menuOpen = false, menuAnchor = null;
let lastMenu = '', lastStrips = '', lastLogs = '', toastTimer, modalPaused = null;
let menuMode = '', menuChoice = '';
const selectedPlane = () => sim?.planes.find(p => p.id === selected);
const canPlan = p => p && (['ready', 'inbound', 'atpoint', 'holding'].includes(p.state) || (['taxi', 'taxiin'].includes(p.state) && p.held));
const stateText = flightStatus;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 3500);
}
function clearPlan() {
  planning = false; waypoints = []; destination = '';
  if (map) { map.preview = []; map.waypoints = []; }
}
function closeMenu(cancelPlan = false) {
  menuOpen = false;
  menuMode = ''; menuChoice = '';
  if (map) map.focusHold = null;
  $('aircraft-menu').hidden = true;
  document.body.classList.remove('context-open');
  if (cancelPlan) { clearPlan(); render(); }
}
function pause(value) {
  paused = value;
  $('pause').innerHTML = icon(paused ? 'play' : 'pause');
  const label = paused ? 'Resume simulation' : 'Pause simulation';
  $('pause').title = label + ' (Space)';
  $('pause').setAttribute('aria-label', label);
  $('simulation-status').textContent = paused ? 'PAUSED' : 'RUNNING';
  refreshIcons();
}
function showDialog(id) {
  closeMenu();
  modalPaused = paused;
  pause(true);
  $(id).showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    if (modalPaused !== null) { pause(modalPaused); modalPaused = null; }
    $('map').focus({ preventScroll: true });
  });
}
function usableWidth() {
  return innerWidth > 600 && !$('traffic-panel').hidden
    ? $('traffic-panel').getBoundingClientRect().left - 14 : innerWidth;
}
function select(id, anchor) {
  const p = sim.planes.find(p => p.id === id && p.state !== 'done');
  if (!p) return;
  if (selected !== id) { clearPlan(); menuMode = ''; menuChoice = ''; }
  selected = id;
  map.selected = id;
  menuOpen = true;
  document.body.classList.add('context-open');
  if (!anchor) {
    const point = map.screen(p);
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    if (point.x < 45 || point.x > usableWidth() - 45 || point.y < top + 60 || point.y > innerHeight - 60) {
      map.camera.x = p.x + (innerWidth / 2 - usableWidth() / 2) / map.camera.zoom;
      map.camera.y = p.y + (innerHeight / 2 - (innerHeight + top) / 2) / map.camera.zoom;
    }
  }
  menuAnchor = anchor || map.screen(p);
  lastMenu = '';
  render();
  $('aircraft-menu').focus({ preventScroll: true });
}
function positionMenu() {
  if (!menuOpen) return;
  const menu = $('aircraft-menu');
  const anchor = menuAnchor || map.screen(selectedPlane());
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 10;
  const right = Math.max(menu.offsetWidth + 24, usableWidth() - 12);
  let x = anchor.x + 26;
  if (x + menu.offsetWidth > right) x = anchor.x - menu.offsetWidth - 26;
  x = Math.max(12, Math.min(right - menu.offsetWidth, x));
  const y = Math.max(top, Math.min(innerHeight - menu.offsetHeight - 12, anchor.y - 24));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}
function preview() {
  const p = selectedPlane();
  if (!canPlan(p)) return;
  planning = true;
  if (p.direction === 'arrival' && !destination) destination = p.stand || sim.freeStands()[0]?.id || '';
  const target = p.direction === 'arrival' ? sim.stands.get(destination)?.node : sim.data.departureHold;
  map.preview = target ? sim.plan(p, target, waypoints) : [];
  map.waypoints = waypoints;
  if (!map.preview.length) toast('No taxi route is available to this destination.');
  lastMenu = ''; render();
}
function options(p) {
  if (!p || p.state === 'done') return [];
  const action = (id, label, glyph, key, primary = false, disabled = false) => ({ id, label, glyph, key, primary, disabled });
  if (p.state === 'gate') return [action('pushback', 'Approve pushback', 'corner-down-left', 'P', true)];
  if (p.state === 'approach') return [
    action('land', 'Clear to land / 24', 'plane-landing', 'L', true, !!sim.runwayOwner),
    action('goaround', 'Go around', 'undo-2', 'G')
  ];
  if (p.state === 'linedup') return [action('takeoff', 'Cleared for takeoff', 'plane-takeoff', 'D', true)];
  const actions = [];
  if (p.state === 'holding') actions.push(action('lineup', 'Line up & wait / 24', 'arrow-up-right', 'U', true, !!sim.runwayOwner));
  if (p.holdReached) actions.push(action('continue', 'Continue taxi', 'play', 'C', true));
  if (canPlan(p)) {
    actions.push(action('preview', planning ? 'Update taxi route' : 'Plan taxi route', 'route', 'T', !planning));
    actions.push(action('holdingpoint', 'Taxi to holding point', 'navigation-2', 'B'));
    if (planning) actions.push(action('taxi', 'Issue taxi clearance', 'check', 'Enter', true, map.preview.length < 2));
  }
  if (['taxi', 'taxiin'].includes(p.state) && !p.holdReached) {
    actions.push(action('holdshort', 'Hold short of...', 'pause', 'S'));
    actions.push(action('follow', 'Follow...', 'route', 'Y'));
    actions.push(action('giveway', 'Give way to...', 'corner-down-left', 'W'));
  }
  if (p.trafficOrder) actions.push(action('canceltraffic', 'Cancel traffic instruction', 'x', 'X'));
  if (['pushback', 'taxi', 'taxiin'].includes(p.state) && !p.holdReached) actions.push(action('hold', p.held ? 'Resume movement' : 'Hold position', p.held ? 'play' : 'pause', 'H'));
  return actions;
}
function instructionChoices(p, mode) {
  if (mode === 'holdingpoint') return sim.holdingPoints().filter(n => n.id !== p.node && sim.plan(p, n.id).length >= 2).map(n => ({ id: n.id, label: n.ref, node: n }));
  if (mode === 'holdshort') return sim.holdOptions(p);
  return sim.trafficCandidates(p, mode).map(q => ({ id: String(q.id), label: q.call }));
}
function execute(action, payload) {
  const result = sim.command(selected, action, payload);
  if (!result.ok) { toast(result.message); return; }
  clearPlan(); closeMenu();
  $('map').focus({ preventScroll: true });
  lastMenu = ''; render();
}
function issue(action) {
  if (action === 'back') { menuMode = ''; menuChoice = ''; map.focusHold = null; lastMenu = ''; render(); return; }
  if (action === 'confirm' && menuMode) {
    if (!instructionChoices(selectedPlane(), menuMode).some(c => c.id === menuChoice)) { toast('That instruction is no longer available.'); return; }
    execute(menuMode === 'holdingpoint' ? 'taxi' : menuMode, { holdingPoint: menuMode === 'holdingpoint' ? menuChoice : undefined, holdPoint: menuChoice, targetId: Number(menuChoice), waypoints });
    return;
  }
  const p = selectedPlane(), option = options(p).find(a => a.id === action);
  if (!option) { toast(p ? 'That action is unavailable: ' + stateText(p) + '.' : 'Select an aircraft first.'); return; }
  if (option.disabled) { toast(action === 'taxi' ? 'A valid taxi route is required.' : 'Runway occupied. Hold position.'); return; }
  if (['holdingpoint', 'holdshort', 'follow', 'giveway'].includes(action)) {
    if (!menuOpen) select(selected);
    menuMode = action;
    menuChoice = instructionChoices(p, action)[0]?.id || '';
    lastMenu = ''; render();
    $('aircraft-menu').focus({ preventScroll: true });
    return;
  }
  if (action === 'preview') {
    if (!menuOpen) select(selected);
    preview();
    if (map.preview.length >= 2) {
      closeMenu();
      $('map').focus({ preventScroll: true });
    }
    return;
  }
  execute(action, { stand: destination, waypoints });
}
function menuHTML(p) {
  if (menuMode) {
    const titles = { holdingpoint: 'Taxi to holding point', holdshort: 'Hold short of', follow: 'Follow aircraft', giveway: 'Give way to aircraft' };
    const choices = instructionChoices(p, menuMode);
    if (!choices.some(c => c.id === menuChoice)) menuChoice = '';
    map.focusHold = choices.find(c => c.id === menuChoice)?.node || null;
    return '<div class="instruction-picker"><button class="icon-button" data-action="back" title="Back" aria-label="Back to actions">' + icon('undo-2') + '</button><label for="instruction-select">' + titles[menuMode] + '</label>' + (choices.length ? '<select id="instruction-select"><option value="" disabled' + (!menuChoice ? ' selected' : '') + '>Choose a target</option>' + choices.map(c => '<option value="' + c.id + '"' + (c.id === menuChoice ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select>' : '<p>No compatible ' + (['follow', 'giveway'].includes(menuMode) ? 'traffic' : 'holding points') + ' ahead.</p>') + '</div><div class="menu-actions" role="menu" aria-label="Clearances for ' + p.call + '"><button role="menuitem" class="menu-action primary-action" data-action="confirm"' + (!menuChoice ? ' disabled' : '') + '>' + icon('check') + '<span class="action-label">' + (menuMode === 'holdingpoint' ? 'Clear taxi' : 'Issue instruction') + '</span><kbd>Enter</kbd></button></div>';
  }
  const arriving = p.direction === 'arrival';
  const actions = options(p);
  let content = '';
  if (p.holdLimit) content += '<div class="route-summary">Hold short: ' + p.holdLimit.label + '</div>';
  if (p.trafficOrder) content += '<div class="route-summary">' + (p.trafficOrder.kind === 'follow' ? 'Follow ' : 'Give way to ') + (sim.planes.find(q => q.id === p.trafficOrder.targetId)?.call || 'traffic') + '</div>';
  if (canPlan(p) && arriving) {
    const choices = sim.data.stands.map(s => {
      const occupied = sim.planes.some(q => q.id !== p.id && q.stand === s.id && q.state !== 'done');
      return '<option value="' + s.id + '" ' + (s.id === destination ? 'selected ' : '') + (occupied ? 'disabled' : '') + '>Stand ' + s.id + (occupied ? ' / occupied' : '') + '</option>';
    }).join('');
    content += '<div class="destination"><label for="stand-select">DESTINATION STAND</label><select id="stand-select"><option value="">Assign stand</option>' + choices + '</select></div>';
  }
  if (planning) content += '<div class="route-summary">' + (sim.routeNames(map.preview).join(' → ') || 'Apron') + ' → ' + (arriving ? 'Stand ' + destination : 'D1 / RWY 24') + '</div>';
  content += '<div class="menu-actions" role="menu" aria-label="Clearances for ' + p.call + '">' + actions.map(a =>
    '<button role="menuitem" class="menu-action ' + (a.primary ? 'primary-action' : '') + '" data-action="' + a.id + '" aria-keyshortcuts="' + a.key + '" ' + (a.disabled ? 'disabled title="Clearance unavailable"' : '') + '>' + icon(a.glyph) + '<span class="action-label">' + a.label + '</span><kbd>' + a.key + '</kbd></button>'
  ).join('') + '</div>';
  if (!actions.length) content += '<div class="clearance-note">' + (p.state === 'parked' ? 'Turnaround in progress' : p.state === 'done' ? 'Handoff complete' : 'Clearance active') + '</div>';
  return content;
}
function render() {
  if (!sim) return;
  const p = selectedPlane();
  $('clock').textContent = formatTime(sim.time);
  $('movements').textContent = sim.completed;
  $('score').textContent = sim.score;
  $('incidents').textContent = sim.incidents;
  const runway = sim.planes.find(p => p.id === sim.runwayOwner);
  $('runway-status').textContent = runway ? runway.call : 'Available';
  $('runway-badge').classList.toggle('occupied', !!runway);
  $('runway-badge').title = runway ? 'Runway 24 occupied by ' + runway.call : 'Runway 24 available';
  if (menuOpen && (!p || p.state === 'done')) closeMenu();
  if (menuOpen) {
    const html = menuHTML(p);
    const menu = $('aircraft-menu');
    menu.hidden = false;
    if (html !== lastMenu) {
      const focusedAction = menu.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      const focusedId = menu.contains(document.activeElement) ? document.activeElement.id : null;
      menu.innerHTML = html; lastMenu = html;
      menu.querySelectorAll('[data-action]').forEach(b => b.onclick = () => issue(b.dataset.action));
      if ($('stand-select')) $('stand-select').onchange = e => { destination = e.target.value; if (planning) preview(); };
      if ($('instruction-select')) $('instruction-select').onchange = e => { menuChoice = e.target.value; lastMenu = ''; render(); };
      if (focusedAction) (menu.querySelector('[data-action="' + focusedAction + '"]') || menu).focus({ preventScroll: true });
      else if (focusedId && $(focusedId)) $(focusedId).focus({ preventScroll: true });
      refreshIcons();
    }
    positionMenu();
  }
  const planes = orderedFlights(sim.planes);
  const pending = planes.filter(requestsAction).length;
  $('traffic-count').textContent = String(planes.length).padStart(2, '0');
  $('pending').textContent = pending + (pending === 1 ? ' request' : ' requests');
  const strips = groupedFlights(planes.filter(p => filter === 'all' || p.direction === filter)).map(group =>
    '<section class="flight-group' + (group.request ? ' request-group' : '') + '" aria-label="' + group.label + '"><h3><span>' + group.label + '</span><span class="group-count">' + group.planes.length + '</span></h3>' + group.planes.map(p =>
      '<button class="strip ' + p.direction + (p.id === selected ? ' selected' : '') + (requestsAction(p) ? ' request' : '') + '" data-flight="' + p.id + '" aria-label="Select ' + p.call + '"><span class="strip-top">' + icon(p.direction === 'arrival' ? 'plane-landing' : 'plane-takeoff') + '<span class="strip-call">' + p.call + '</span></span><span class="strip-meta">' + p.type + ' / ' + (p.holdLimit ? p.holdLimit.label : p.holdLabel && p.state === 'atpoint' ? p.holdLabel : p.stand ? 'S' + p.stand : '24') + '</span></button>'
    ).join('') + '</section>'
  ).join('') || '<div class="empty">No flights in this queue.</div>';
  if (strips !== lastStrips) {
    const focusedId = $('strips').contains(document.activeElement) ? document.activeElement.dataset.flight : null;
    $('strips').innerHTML = strips; lastStrips = strips;
    $('strips').querySelectorAll('[data-flight]').forEach(b => b.onclick = () => select(+b.dataset.flight));
    if (focusedId) $('strips').querySelector('[data-flight="' + focusedId + '"]')?.focus({ preventScroll: true });
    refreshIcons();
  }
  const logs = sim.logs.slice(0,12).map(l => '<div class="log-entry ' + l.type + '"><time>' + formatTime(l.time).slice(3,8) + '</time><span>' + l.text + '</span></div>').join('');
  if (logs !== lastLogs) { $('radio-log').innerHTML = logs; lastLogs = logs; }
  $('route-banner').hidden = !planning;
  $('route-text').textContent = (waypoints.length ? waypoints.length + ' via / ' : '') + 'Taxi to ' + (p?.direction === 'arrival' ? 'stand ' + destination : 'D1 / 24');
  $('route-issue').disabled = map.preview.length < 2;
}
function restart() {
  clearTimeout(toastTimer); $('toast').hidden = true;
  sim.reset(); clearPlan(); closeMenu(); selected = 1; map.selected = 1;
  filter = 'all'; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  pause(false); map.fit(); lastLogs = ''; lastStrips = ''; render();
}
$('pause').onclick = () => pause(!paused);
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
  speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('active', x === b));
});
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b)); render();
});
$('zoom-in').onclick = () => { closeMenu(); map.zoom(1.3); };
$('zoom-out').onclick = () => { closeMenu(); map.zoom(1 / 1.3); };
$('fit').onclick = () => { closeMenu(); map.fit(); };
$('labels').onclick = () => { map.labels = !map.labels; $('labels').classList.toggle('active', map.labels); $('labels').setAttribute('aria-pressed', String(map.labels)); };
$('toggle-panel').onclick = () => {
  const visible = $('traffic-panel').hidden;
  $('traffic-panel').hidden = !visible;
  $('toggle-panel').classList.toggle('active', visible);
  $('toggle-panel').setAttribute('aria-expanded', String(visible));
  closeMenu();
};
$('route-clear').onclick = () => { waypoints = []; preview(); };
$('route-issue').onclick = () => issue('taxi');
$('airport-button').onclick = () => showDialog('airport-dialog');
$('select-edinburgh').onclick = () => $('airport-dialog').close();
$('restart').onclick = () => showDialog('restart-dialog');
$('cancel-restart').onclick = () => $('restart-dialog').close();
$('confirm-restart').onclick = () => { $('restart-dialog').close(); restart(); };
$('shortcuts').onclick = () => showDialog('shortcuts-dialog');
document.addEventListener('pointerdown', e => {
  if (menuOpen && !$('aircraft-menu').contains(e.target) && !$('strips').contains(e.target) && e.target !== $('map')) closeMenu();
});
document.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  const target = document.activeElement;
  if (target.matches('input,textarea,select') || target.isContentEditable) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); $('map').focus({ preventScroll: true }); return; }
  if (menuOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && $('aircraft-menu').contains(target)) {
    const buttons = [...$('aircraft-menu').querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    e.preventDefault();
    const index = buttons.indexOf(target);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); return;
  }
  if (e.key === '?') { e.preventDefault(); showDialog('shortcuts-dialog'); return; }
  if (e.code === 'Space') {
    if (target.matches('button,summary')) return;
    e.preventDefault(); pause(!paused); return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'f') { e.preventDefault(); closeMenu(); map.fit(); return; }
  if (key === 'n') {
    e.preventDefault(); const queue = orderedFlights(sim.planes).filter(requestsAction);
    if (queue.length) select(queue[(queue.findIndex(p => p.id === selected) + 1) % queue.length].id);
    return;
  }
  const action = shortcuts[key];
  if (!action) return;
  if (key === 'Enter' && target.matches('button')) return;
  if (key === 'Enter' && menuMode) { e.preventDefault(); issue('confirm'); return; }
  if (key === 'Enter' && (!planning || target.closest('.topbar,.control-panel'))) return;
  e.preventDefault(); issue(action);
});
window.addEventListener('resize', () => { closeMenu(); });

async function start() {
  try {
    sim = new GroundSim(airportData);
    map = new AirportMap($('map'), sim, select, id => {
      if (canPlan(selectedPlane())) {
        if (!planning) preview();
        if (waypoints.at(-1) !== id) waypoints.push(id);
        preview();
      }
    }, () => closeMenu());
    $('map-loading').hidden = true;
    if (innerWidth <= 600) document.querySelector('.communications').open = false;
    const dataDownload = $('airport-dialog').querySelector('a');
    dataDownload.href = URL.createObjectURL(new Blob([JSON.stringify(airportData)], { type: 'application/json' }));
    dataDownload.download = 'egph.json';
    render();
    window.groundControl = { sim, map, select, issue, preview, setPaused: pause, getState: () => ({
      time: sim.time, score: sim.score, completed: sim.completed, runway: sim.runwayOwner,
      flights: sim.planes.map(({ id, call, state, x, y, stand, held, holdLimit, holdReached, trafficOrder, trafficWaiting }) => ({ id, call, state, x, y, stand, held, holdLimit, holdReached, trafficOrder, trafficWaiting }))
    }) };
    const context = document.modelContext;
    if (context?.registerTool) {
      const controller = new AbortController();
      window.addEventListener('pagehide', () => controller.abort(), { once: true });
      const tools = [
        { name: 'read_ground_control', description: 'Read the airport simulation and flight states.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => window.groundControl.getState() },
        { name: 'issue_ground_clearance', description: 'Issue a clearance to an aircraft using the same rules as the context menu.', inputSchema: { type: 'object', properties: { flightId: { type: 'integer' }, action: { type: 'string', enum: ['pushback','hold','taxi','lineup','takeoff','land','goaround','holdshort','follow','giveway','continue','canceltraffic'] }, stand: { type: 'string' }, holdingPoint: { type: 'string' }, holdPoint: { type: 'string' }, targetId: { type: 'integer' } }, required: ['flightId','action'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => {
          if (!Number.isInteger(input.flightId) || typeof input.action !== 'string') throw new Error('Invalid clearance');
          const result = sim.command(input.flightId, input.action, input);
          if (result.ok && input.flightId === selected) { clearPlan(); closeMenu(); }
          render(); return result;
        } }
      ];
      for (const tool of tools) { try { Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch {} }
    }
    let previous = performance.now(), lastUI = 0;
    function frame(now) {
      const dt = Math.min((now - previous) / 1000, .1); previous = now;
      if (!paused) {
        let remaining = dt * speed;
        while (remaining > 0) { const step = Math.min(.1, remaining); sim.tick(step); remaining -= step; }
      }
      map.draw();
      if (now - lastUI > 150) { render(); lastUI = now; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (error) { $('map-loading').textContent = error.message; console.error(error); }
}
refreshIcons();
start();
