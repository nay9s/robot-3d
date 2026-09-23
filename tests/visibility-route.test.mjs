import assert from 'node:assert/strict';
import {ARENA,buildArenaState} from '../arena-state.js';
import {DEFAULT_SETTINGS} from '../settings-store.js';
import {planRoute,buildCollisionContext,directEdgeIsClear,buildCommands} from '../path-planner.js';
import {generateArduinoCode} from '../arduino-exporter.js';
let found=0,blocked=0;
for(const [leftDie,rightDie] of [[5,5],[5,7],[2,2],[9,3]])
for(const directionDie of [1,3]) for(const mode of ['score','fastest']) for(const margin of [0,.1,.2]) {
 const diceState=buildArenaState({directionDie,leftDie,rightDie});
 const settings={...DEFAULT_SETTINGS,planningMode:mode,directLine:true,directSafetyMargin:margin};
 const route=planRoute({arena:ARENA,diceState,settings});
 if(route.status!=='found'){blocked++;continue;} found++;
 const context={...buildCollisionContext({arena:ARENA,diceState,settings}),targetGoalType:route.goalType,directExit:true};
 for(const seg of route.segments) assert(directEdgeIsClear(seg.from,seg.to,context,settings));
 const recomputed=buildCommands(route.points,diceState.robotDirection,settings);
 assert.deepEqual(route.commands,recomputed.commands);
 assert(Math.abs(route.totalDistance-route.segments.reduce((sum,s)=>sum+s.distance,0))<1e-8);
 assert.equal(route.segments.length,route.commands.filter(c=>['forward','reverse'].includes(c.type)).length);
 const code=generateArduinoCode({route,diceState,settings});
 assert(code.includes(`const RobotStep ROUTE_STEPS[]`));
 if(leftDie===5 && rightDie===5 && directionDie===3) {
   assert(route.turnCount<=3,'Screenshot case: remove the lateral detour near exit');
   const last=route.segments.at(-1);
   assert(last.from.z<1,'Final run should go directly from obstacle area through exit');
 }
}
// Reject unsafe diagonal crossing even when centerline falls in opening.
const diceState=buildArenaState({directionDie:3,leftDie:5,rightDie:5});
const settings={...DEFAULT_SETTINGS,directSafetyMargin:0};
const context={...buildCollisionContext({arena:ARENA,diceState,settings}),targetGoalType:'bonus',directExit:true};
assert(!directEdgeIsClear({x:-.8,z:1.2},{x:-1.8,z:1.8},context,settings));
// Existing orthogonal mode still returns only 90/180 degree turns.
const orthogonal=planRoute({arena:ARENA,diceState,settings:{...settings,planningMode:'pass',directLine:true}});
assert.equal(orthogonal.status,'found');
assert(orthogonal.commands.filter(c=>c.degrees).every(c=>[90,180].includes(c.degrees)));
console.log(`Visibility cases: ${found} valid routes, ${blocked} no-path/start-blocked; collision, exit and export checks passed`);
