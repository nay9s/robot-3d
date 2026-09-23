#pragma once
#include "Arduino.h"
struct WireStub {
 void begin(){} void end(){} void setClock(int){} void setWireTimeout(unsigned long,bool){}
 void beginTransmission(int){} void write(int){} int endTransmission(bool=true){return 0;}
 int requestFrom(int,int n,bool=true){return n;} int available(){return 0;} int read(){return 0;}
};
inline WireStub Wire;
