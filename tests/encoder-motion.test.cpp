#include <cassert>
#include <cmath>
#include <iostream>
#include "../ArduinoProj/encoder_motion/EncoderMotion.h"
using namespace EncoderMotion;
int main() {
  // Saturated output cannot accumulate additional integral, but can unwind.
  assert(integrate(10, 5, .1, 1, 100, 0, 100, 50)==10);
  assert(integrate(10, -5, .1, 1, 100, 0, 100, 50)<10);
  Profile p;
  auto r=p.step(0,0,30,27,.55,25,10,30,40,.01);
  assert(r.left>0 && r.left<=.301f && r.right<r.left);
  for(int i=0;i<200;i++) r=p.step(0,0,300,270,.55,25,10,30,40,.01);
  assert(r.left<=25 && r.right<=25);
  r=p.step(240,135,300,270,.55,25,10,30,40,.01);
  assert(r.right>r.left); // leader must slow, follower catches up
  r=p.step(300,269,300,270,.55,25,10,30,40,.01);
  assert(r.left==0 && r.right>0);
  r=p.step(300,270,300,270,.55,25,10,30,40,.01);
  assert(r.left==0 && r.right==0);
  Profile decel;
  for(int i=0;i<200;i++) r=decel.step(0,0,300,300,.55,50,10,30,40,.01);
  float fast=r.left;
  for(int i=0;i<200;i++) r=decel.step(299,299,300,300,.55,50,10,30,40,.01);
  assert(r.left<fast && r.left<=10.01f);
  Wheel w12(0),w8(0);
  for(unsigned long t=5;t<=1000;t+=5) {
    int a=w12.update(t, t/22,25,.55,4095,.58,.1465);
    int b=w8.update(t, t/22,25,.55,255,.58,.1465);
    assert(a>=0 && a<=2376 && b>=0 && b<=148);
    assert(fabs(a/4095.f-b/255.f)<.005f);
  }
  assert(w12.update(1005,45,0,.55,4095,.58)==0);
  // Synthetic ideal plant with unequal targets: synchronized completion.
  Profile plantProfile; Wheel l(0), rr(0);
  float nl=0,nr=0;
  unsigned long t=0;
  for(t=5;t<15000 && (nl<100 || nr<90);t+=5) {
    auto ref=plantProfile.step((unsigned long)nl,(unsigned long)nr,100,90,.55,25,10,30,40,.005);
    int pl=l.update(t,(unsigned long)nl,ref.left,.55,4095,.58);
    int pr=rr.update(t,(unsigned long)nr,ref.right,.55,4095,.58);
    nl+=pl/47.5f*.005f/.55f; nr+=pr/47.5f*.005f/.55f;
  }
  assert(t<15000 && nl<102 && nr<92);
  std::cout<<"controller tests passed\n";
}
