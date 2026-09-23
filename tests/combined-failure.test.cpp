#include "arduino-stubs/Arduino.h"
#include "../ArduinoProj/combined_state_sequence.ino"
#include <cassert>
#include <iostream>
int main(){
  // No encoder pulses: actual setup must abort before state 2.
  setup();
  assert(straightStalled);
  assert(Serial.log.find("STATE FAILED - ROUTE ABORTED")!=std::string::npos);
  assert(Serial.log.find("CURRENT STATE 2/")==std::string::npos);
  assert(Serial.log.find("ALL COMBINED STATES COMPLETE")==std::string::npos);
  assert(motorOutput[ENA]==0 && motorOutput[ENB]==0);
  Serial.log.clear();
  bool ok=runCombinedRotationState(2,"test",90,1);
  assert(!ok && rotationAbortedWheelStart);
  assert(motorOutput[ENA]==0 && motorOutput[ENB]==0);
  std::cout<<"combined failure propagation tests passed\n";
}
