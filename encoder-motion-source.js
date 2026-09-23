// Generated from ArduinoProj/encoder_motion/EncoderMotion.h by tests/sync-encoder-controller.py
export const ENCODER_MOTION_SOURCE = String.raw`#ifndef ENCODER_MOTION_H
#define ENCODER_MOTION_H
#include <math.h>

// Encoder-only control math. Units: cm, seconds, PWM normalized to 0..1.
// Calibration targets remain STOP-COMMAND counts, not measured body angles.
namespace EncoderMotion {
inline float clamp(float x, float lo, float hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}
inline float lesser(float a, float b) { return a < b ? a : b; }

// Conditional integration: allow unwinding, but do not integrate further
// into actuator saturation. Call using the complete feedforward + P output.
inline float integrate(float integral, float error, float dt, float ki,
                       float base, float lo, float hi, float limit) {
  float candidate = clamp(integral + error * dt, -limit, limit);
  float output = base + ki * candidate;
  if ((output > hi && error > 0) || (output < lo && error < 0)) return integral;
  return candidate;
}

struct References { float left; float right; };
class Profile {
  float speed;
public:
  Profile() : speed(0) {}
  References step(float left, float right, float targetL, float targetR,
                  float cmPerTick, float cruise, float crawl,
                  float acceleration, float deceleration, float dt) {
    return step(left, right, targetL, targetR, cmPerTick, cmPerTick,
                cruise, crawl, acceleration, deceleration, dt);
  }
  References step(float left, float right, float targetL, float targetR,
                  float leftCmPerTick, float rightCmPerTick,
                  float cruise, float crawl,
                  float acceleration, float deceleration, float dt) {
    References out = {0, 0};
    if (targetL <= 0 || targetR <= 0) return out;
    float lengthL = targetL * leftCmPerTick, lengthR = targetR * rightCmPerTick;
    float longest = lengthL > lengthR ? lengthL : lengthR;
    float ratioL = lengthL / longest, ratioR = lengthR / longest;
    float remainingL = fmaxf(0, targetL - left) * leftCmPerTick / ratioL;
    float remainingR = fmaxf(0, targetR - right) * rightCmPerTick / ratioR;
    // Use the lagging wheel's remaining path; never resume a completed wheel.
    float remaining = fmaxf(remainingL, remainingR);
    float allowed = fminf(cruise, fmaxf(crawl, sqrtf(2 * deceleration * remaining)));
    speed = clamp(allowed, fmaxf(0, speed - deceleration * dt), speed + acceleration * dt);
    // Progress difference expressed as equivalent cm on the longer wheel path.
    float mismatch = (left / targetL - right / targetR) * longest;
    float correction = clamp(0.8f * mismatch, -3.0f, 3.0f);
    out.left = left >= targetL ? 0 : clamp(speed * ratioL - correction, 0, cruise);
    out.right = right >= targetR ? 0 : clamp(speed * ratioR + correction, 0, cruise);
    return out;
  }
};

class Wheel {
  unsigned long sampleMs, sampleTicks;
  float velocity, integral;
  bool ready;
public:
  Wheel(unsigned long now) : sampleMs(now), sampleTicks(0), velocity(0), integral(0), ready(false) {}
  float measuredSpeed() const { return velocity; }
  int update(unsigned long now, unsigned long ticks, float reference,
             float cmPerTick, int pwmMax, float ceiling, float feedforwardOffset = 0) {
    unsigned long elapsed = now - sampleMs;
    unsigned long delta = ticks - sampleTicks;
    if (elapsed >= 100 && (delta >= 2 || elapsed >= 200)) {
      float dt = elapsed * 0.001f;
      float measured = delta * cmPerTick / dt;
      velocity = ready ? 0.6f * measured + 0.4f * velocity : measured;
      ready = true;
      float base = feedforwardOffset + (47.5f / 4095.0f) * reference
                 + (30.0f / 4095.0f) * (reference - velocity);
      if (reference > 0)
        integral = integrate(integral, reference - velocity, dt,
                             25.0f / 4095.0f, base, 0, ceiling, 50);
      sampleMs = now;
      sampleTicks = ticks;
    }
    if (reference <= 0) { integral = 0; return 0; }
    float output = feedforwardOffset + (47.5f / 4095.0f) * reference
                 + (30.0f / 4095.0f) * (reference - velocity)
                 + (25.0f / 4095.0f) * integral;
    return (int)lroundf(clamp(output, 0, ceiling) * pwmMax);
  }
};
}
#endif
`;
