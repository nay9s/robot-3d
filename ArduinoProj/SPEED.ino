#define m1 9   // มอเตอร์ขวา เดินหน้า (MA1)
#define m2 8   // มอเตอร์ขวา ถอยหลัง (MA2)
#define m3 7   // มอเตอร์ซ้าย เดินหน้า (MB1)
#define m4 6   // มอเตอร์ซ้าย ถอยหลัง (MB2)
#define e1 5   // PWM ควบคุมความเร็ว มอเตอร์ขวา (EA)
#define e2 10  // PWM ควบคุมความเร็ว มอเตอร์ซ้าย (EB)
 
 
//********** การเชื่อมต่อเซ็นเซอร์ IR 5 ช่อง **********//
// หมายเหตุ: เจอเส้นดำ = LOW (0), ไม่เจอเส้น = HIGH (1)
#define ir1 A0  // s1 = เซ็นเซอร์ซ้ายสุด
#define ir2 A1  // s2 = เซ็นเซอร์ซ้าย
#define ir3 A2  // s3 = เซ็นเซอร์กลาง
#define ir4 A3  // s4 = เซ็นเซอร์ขวา
#define ir5 A4  // s5 = เซ็นเซอร์ขวาสุด
//*************************************************//
 
 
void setup() {
  pinMode(m1, OUTPUT); // ขวาเดินหน้า
  pinMode(m2, OUTPUT); // ขวาถอยหลัง
  pinMode(m3, OUTPUT); // ซ้ายเดินหน้า
  pinMode(m4, OUTPUT); // ซ้ายถอยหลัง
  pinMode(e1, OUTPUT); // PWM มอเตอร์ขวา
  pinMode(e2, OUTPUT); // PWM มอเตอร์ซ้าย
 
  pinMode(ir1, INPUT); // เซ็นเซอร์ซ้ายสุด
  pinMode(ir2, INPUT); // เซ็นเซอร์ซ้าย
  pinMode(ir3, INPUT); // เซ็นเซอร์กลาง
  pinMode(ir4, INPUT); // เซ็นเซอร์ขวา
  pinMode(ir5, INPUT); // เซ็นเซอร์ขวาสุด
 
}
 
 
void loop() {
  // อ่านค่าจากเซ็นเซอร์
  int s1 = digitalRead(ir1);  // ซ้ายสุด
  int s2 = digitalRead(ir2);  // ซ้าย
  int s3 = digitalRead(ir3);  // กลาง
  int s4 = digitalRead(ir4);  // ขวา
  int s5 = digitalRead(ir5);  // ขวาสุด
 
 
  // ========== วิ่งตรง ==========
  if((s1 == 1) && (s2 == 1) && (s3 == 0) && (s4 == 1) && (s5 == 1))
  {
    // เฉพาะเซ็นเซอร์กลางเจอเส้น → วิ่งตรง
    analogWrite(e1, 255); // มอเตอร์ขวาเต็มสปีด
    analogWrite(e2, 255); // มอเตอร์ซ้ายเต็มสปีด
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW); // ขวาเดินหน้า
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW); // ซ้ายเดินหน้า
  }
 
 
  // ========== เบี่ยงขวาเล็กน้อย ==========
  if((s1 == 1) && (s2 == 0) && (s3 == 1) && (s4 == 1) && (s5 == 1))
  {
    // เซ็นเซอร์ซ้ายเจอเส้น → ต้องเลี้ยวขวาเล็กน้อย
    analogWrite(e1, 170); // มอเตอร์ขวาเร็ว
    analogWrite(e2, 255); // มอเตอร์ซ้ายช้าลง
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW); // ขวาเดินหน้า
    digitalWrite(m3, LOW);  digitalWrite(m4, LOW); // ซ้ายหยุด
  }
 
 
  // ========== เบี่ยงขวามาก ==========
  if((s1 == 0) && (s2 == 1) && (s3 == 1) && (s4 == 1) && (s5 == 1))
  {
    // เซ็นเซอร์ซ้ายสุดเจอเส้น → ต้องเลี้ยวขวามาก
    analogWrite(e1, 255); // มอเตอร์ขวาเร็ว
    analogWrite(e2, 140); // มอเตอร์ซ้ายช้าลง
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW); // ขวาเดินหน้า
    digitalWrite(m3, LOW);  digitalWrite(m4, HIGH); // ซ้ายถอยหลัง
  }
 
 
  // ========== เบี่ยงซ้ายเล็กน้อย ==========
  if((s1 == 1) && (s2 == 1) && (s3 == 1) && (s4 == 0) && (s5 == 1))
  {
    // เซ็นเซอร์ขวาเจอเส้น → ต้องเลี้ยวซ้ายเล็กน้อย
    analogWrite(e1, 140); // มอเตอร์ขวาช้าลง
    analogWrite(e2, 255); // มอเตอร์ซ้ายเร็ว
    digitalWrite(m1, LOW);  digitalWrite(m2, HIGH); // ขวาหยุด
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW); // ซ้ายเดินหน้า
  }
 
 
  // ========== เบี่ยงซ้ายมาก ==========
  if((s1 == 1) && (s2 == 1) && (s3 == 1) && (s4 == 1) && (s5 == 0))
  {
    // เซ็นเซอร์ขวาสุดเจอเส้น → ต้องเลี้ยวซ้ายมาก
    analogWrite(e1, 170); // มอเตอร์ขวาช้าลง
    analogWrite(e2, 255); // มอเตอร์ซ้ายเร็ว
    digitalWrite(m1, LOW);  digitalWrite(m2, HIGH); // ขวาถอยหลัง
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW);  // ซ้ายเดินหน้า
  }
 
 
  // ========== กลาง + ขวาเจอเส้น ==========
  if((s1 == 1) && (s2 == 1) && (s3 == 0) && (s4 == 0) && (s5 == 1))
  {
    // เริ่มเบี่ยงซ้าย
    analogWrite(e1, 140); // ขวาช้าลง
    analogWrite(e2, 255); // ซ้ายเร็ว
    digitalWrite(m1, LOW);  digitalWrite(m2, HIGH); // ขวาหยุด
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW); // ซ้ายเดินหน้า
  }
 
 
  // ========== กลาง + ซ้ายเจอเส้น ==========
  if((s1 == 1) && (s2 == 0) && (s3 == 0) && (s4 == 1) && (s5 == 1))
  {
    // เริ่มเบี่ยงขวา
    analogWrite(e1, 255); // ขวาเร็ว
    analogWrite(e2, 160); // ซ้ายช้า
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW); // ขวาเดินหน้า
    digitalWrite(m3, LOW);  digitalWrite(m4, LOW); // ซ้ายหยุด
  }
 
 
  // ========== ซ้ายสุด + ซ้าย + กลางเจอเส้น ==========
  if((s1 == 0) && (s2 == 0) && (s3 == 0) && (s4 == 1) && (s5 == 1))
  {
    // ต้องเลี้ยวขวามาก
   
    analogWrite(e1, 250); // ขวาเร็ว
    analogWrite(e2, 140); // ซ้ายช้า
    digitalWrite(m1, HIGH); digitalWrite(m2, LOW); // ขวาเดินหน้า
    digitalWrite(m3, LOW);  digitalWrite(m4, LOW); // ซ้ายหยุด
  }
 
 
  // ========== ขวาสุด + ขวา + กลางเจอเส้น ==========
  if((s1 == 1) && (s2 == 1) && (s3 == 0) && (s4 == 0) && (s5 == 0))
  {
    // ต้องเลี้ยวซ้ายมาก
 
    analogWrite(e1, 130); // ขวาช้า
    analogWrite(e2, 220); // ซ้ายเร็ว
    digitalWrite(m1, LOW);  digitalWrite(m2, LOW); // ขวาหยุด
    digitalWrite(m3, HIGH); digitalWrite(m4, LOW); // ซ้ายเดินหน้า
  }
 
 
  // ========== ทุกตัวเจอเส้น ==========
  if((s1 == 0) && (s2 == 0) && (s3 == 0) && (s4 == 0) && (s5 == 0))
  {
    // หยุดรถ
    digitalWrite(m1, LOW);
    digitalWrite(m2, LOW);
    digitalWrite(m3, LOW);
    digitalWrite(m4, LOW);
  }
}

