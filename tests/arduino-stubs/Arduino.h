#pragma once
#include <cmath>
#include <cstdint>
#include <string>
#include <sstream>
#include <algorithm>
using std::min; using std::max; using std::isfinite;
#define PI 3.14159265358979323846
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define CHANGE 3
#define SDA 18
#define SCL 19
#define F(x) x
using __FlashStringHelper = char;
using byte = unsigned char;
template<typename T, typename L, typename H> T constrain(T x,L l,H h){return x<l?l:(x>h?h:x);}
inline unsigned long fakeTime=0;
inline int motorOutput[30]={};
inline unsigned long millis(){return ++fakeTime;}
inline unsigned long micros(){return millis()*1000;}
inline void delay(unsigned long ms){fakeTime+=ms;}
inline void delayMicroseconds(unsigned long us){fakeTime+=us/1000;}
inline void analogWrite(int p,int v){motorOutput[p]=v;}
inline void analogWriteResolution(int){}
inline void digitalWrite(int,int){}
inline int digitalRead(int){return HIGH;}
inline void pinMode(int,int){}
inline void noInterrupts(){}
inline void interrupts(){}
inline int digitalPinToInterrupt(int p){return p;}
inline void attachInterrupt(int,void(*)(),int){}
inline long pulseIn(int,int,unsigned long){return 0;}
struct SerialStub {
  std::string log;
  void begin(int){}
  template<class T> void print(T x){std::ostringstream s;s<<x;log+=s.str();}
  template<class T> void print(T x,int){print(x);}
  void println(){log+='\n';}
  template<class T> void println(T x){print(x);println();}
  template<class T> void println(T x,int n){print(x,n);println();}
  int available(){return 0;}
  int read(){return -1;}
};
inline SerialStub Serial;
