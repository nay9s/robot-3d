import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateArduinoCode} from '../arduino-exporter.js';
import {ENCODER_MOTION_SOURCE} from '../encoder-motion-source.js';
assert.equal(ENCODER_MOTION_SOURCE,fs.readFileSync(new URL('../ArduinoProj/encoder_motion/EncoderMotion.h',import.meta.url),'utf8'));
const commands=[{type:'reverse',distance:1,label:'reverse'},{type:'turn-right',degrees:90,label:'right'}];
for(const boardType of ['uno_r4','uno_r3']) for(const useUltrasonic of [false,true]) {
 const code=generateArduinoCode({route:{commands},boardType,settings:{useUltrasonic}});
 assert(code.includes(ENCODER_MOTION_SOURCE));
 assert(code.includes('STEP_REVERSE'));
 assert(code.includes('if (motionResult != MOTION_OK)'));
 assert(code.includes(boardType==='uno_r4'?'const int PWM_MAX = 4095':'const int PWM_MAX = 255'));
 const file=process.env.ROBOT_TEST_OUTPUT;
 if(file) fs.writeFileSync(`${file}/${boardType}-${useUltrasonic}.ino`,code);
}
const calibrated=generateArduinoCode({route:{commands},settings:{leftCmPerTick:.54,rightCmPerTick:.56}});
assert(calibrated.includes('const float LEFT_CM_PER_TICK = 0.5400f;'));
assert(calibrated.includes('const float RIGHT_CM_PER_TICK = 0.5600f;'));
assert(calibrated.includes('distanceCM / LEFT_CM_PER_TICK * STRAIGHT_DISTANCE_SCALE'));
assert(calibrated.includes('distanceCM / RIGHT_CM_PER_TICK * STRAIGHT_DISTANCE_SCALE'));
const timed=generateArduinoCode({route:{commands},profile:'timed',boardType:'uno_r4',settings:{speed:.5},baseSpeed:2375});
assert(timed.includes('const int PWM_DRIVE = 148;'));
assert(timed.includes('const int PWM_TURN  = 125;'));
assert.throws(()=>generateArduinoCode({route:{status:'no_path',commands:[]}}),RangeError);
console.log('exporter controller tests passed (2 boards, sensor on/off, wheel calibration and timed PWM)');
