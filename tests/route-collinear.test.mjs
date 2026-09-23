import assert from 'node:assert/strict';
import {ARENA,buildArenaState} from '../arena-state.js';
import {DEFAULT_SETTINGS} from '../settings-store.js';
import {planRoute,buildCommands,compactCollinearPoints,buildCollisionContext,directEdgeIsClear} from '../path-planner.js';
const points=Array.from({length:31},(_,i)=>({x:0,z:-i*.05}));
const copy=JSON.stringify(points);
const straight=buildCommands(points,'ล่าง',DEFAULT_SETTINGS);
assert.equal(straight.commands.length,1);
assert.equal(straight.commands[0].type,'reverse');
assert(Math.abs(straight.commands[0].distance-1.5)<1e-9);
assert.equal(straight.segments.length,1);
assert.equal(JSON.stringify(points),copy);
for (const path of [
 [{x:0,z:0},{x:0,z:1},{x:1,z:1}],
 [{x:0,z:0},{x:0,z:1},{x:0,z:0}],
 [{x:0,z:0},{x:1,z:1},{x:2,z:2.0001}],
]) assert.equal(compactCollinearPoints(path).length,3);
assert.equal(compactCollinearPoints([{x:0,z:0},{x:0,z:0},{x:1,z:1},{x:2,z:2}]).length,2);
const diceState=buildArenaState({directionDie:3,leftDie:5,rightDie:7});
const settings={...DEFAULT_SETTINGS,planningMode:'score',directLine:true,directSafetyMargin:0.1};
const route=planRoute({arena:ARENA,diceState,settings});
assert.equal(route.status,'found');
assert(route.segments.length<10);
const context=buildCollisionContext({arena:ARENA,diceState,settings});
context.targetGoalType=route.goalType;
for(const s of route.segments) assert(directEdgeIsClear(s.from,s.to,context,settings), 'Merged segment must remain collision-free');
for(const gridSize of [0.025,0.05,0.10]) {
 const gridRoute=planRoute({arena:ARENA,diceState,settings:{...DEFAULT_SETTINGS,gridSize}});
 assert.equal(gridRoute.status,'found');
 assert(Math.hypot(gridRoute.points[0].x-ARENA.robot.x,gridRoute.points[0].z-ARENA.robot.z)<1e-9,
   `Grid ${gridSize} must include the real robot start`);
}
const tightExit=planRoute({arena:ARENA,
 diceState:buildArenaState({directionDie:3,leftDie:2,rightDie:2}),settings:DEFAULT_SETTINGS});
assert.equal(tightExit.status,'found');
assert(tightExit.segments.every(segment=>segment.distance>=.10-1e-8),
  'Orthogonal exit must not contain a fragile five-centimetre shuffle');
console.log('Collinear regression passed:',route.segments.length,'segments,',route.commands.length,'commands');
