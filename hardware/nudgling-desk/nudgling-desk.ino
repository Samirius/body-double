// Nudgling Desk: the creature on your desk (ESP32 + RC522 RFID + 1.8" ST7735 TFT).
// Talks to the Nudgling app over the USB cable (115200 baud, one line per message).
//
//   Desk -> PC:  HELLO nudgling-desk 1 | CARD <uid hex> | BTN 1
//   PC -> Desk:  S <pose 0-4> <stage 1-4>   pose: idle, talk, cheer, sleep, worry
//                T <left s> <total s> <F|B|->  focus ring (focus, break, none)
//                Q <quest>  N <next step>  F <flow level>  M <message>
//                L <minutes>  card-lock pulse (red flash)    C  cheer    P  ping
//
// Wiring (same as the arcade card project): shared SPI SCK 18, MOSI 23, MISO 19
//   RC522: SDA/SS 5, RST 22          ST7735: CS 15, DC 2, RST 4, LED 3.3V
//   Button (optional, "done"): GPIO 14 to GND
// Libraries (Arduino Library Manager): "Adafruit ST7735 and ST7789 Library",
// "Adafruit GFX Library", "MFRC522" (GithubCommunity / miguelbalboa).
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <MFRC522.h>
#include "sprites.h"

#define TFT_CS 15
#define TFT_DC 2
#define TFT_RST 4
#define RFID_SS 5
#define RFID_RST 22
#define BTN_PIN 14

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
MFRC522 rfid(RFID_SS, RFID_RST);

// Screen: 128 x 160 portrait. Creature 96 x 96 (24 cells x 4) inside the ring.
const int W = 128, H = 160, SCALE = 4, PET_X = 16, PET_Y = 8, RING_CX = 64, RING_CY = 56, RING_R = 54;
const uint16_t BG = 0x0841, CYAN = 0x07FF, MAGENTA = 0xF81F, GREEN = 0x3FF3, RED = 0xF8A6, DIM = 0x2945, WHITE = 0xFFFF;

int pose = POSE_IDLE, stage = 1, flow = 0;
long secsLeft = 0, secsTotal = 0; char ringKind = '-';
String quest = "Nudgling", nextStep = "Tap a card to start", message = "";
unsigned long messageUntil = 0, cheerUntil = 0, pulseUntil = 0, lastFrame = 0, lastTick = 0, lastCardAt = 0;
int frameN = 0, lastDrawnFrame = -1;
String lastCard = "", line = "";
bool textDirty = true, ringDirty = true;

void drawSprite(int frame) {
  const uint8_t* px = SPRITES[frame];
  for (int y = 0; y < SPRITE_SIZE; y++) {
    for (int x = 0; x < SPRITE_SIZE; x++) {
      uint8_t idx = pgm_read_byte(&px[y * SPRITE_SIZE + x]);
      uint16_t color = idx ? pgm_read_word(&PALETTES[stage - 1][idx]) : BG;
      tft.fillRect(PET_X + x * SCALE, PET_Y + y * SCALE, SCALE, SCALE, color);
    }
  }
}

// The focus ring: segments for the time left, draining clockwise from the top.
void drawRing() {
  for (int a = 0; a < 360; a += 6) {
    float rad = (a - 90) * DEG_TO_RAD;
    int x = RING_CX + cos(rad) * RING_R, y = RING_CY + sin(rad) * RING_R;
    bool lit = secsTotal > 0 && a < 360.0 * secsLeft / secsTotal;
    uint16_t c = !secsTotal ? BG : lit ? (ringKind == 'B' ? GREEN : CYAN) : DIM;
    tft.fillRect(x - 1, y - 1, 3, 3, c);
  }
}

// Fits ASCII text into one line of the given width (6 px per char at size 1).
String fit(const String& s, int chars) { return s.length() <= (unsigned)chars ? s : s.substring(0, chars - 1) + "~"; }

void drawText() {
  tft.fillRect(0, 114, W, H - 114, BG);
  tft.setTextWrap(false);
  tft.setTextSize(1);
  bool showMessage = message.length() && millis() < messageUntil;
  tft.setTextColor(showMessage ? MAGENTA : CYAN);
  tft.setCursor(2, 116); tft.print(fit(showMessage ? message : quest, 21));
  tft.setTextColor(WHITE);
  String body = showMessage ? message.substring(min((int)message.length(), 21)) : nextStep;
  tft.setCursor(2, 128); tft.print(fit(body, 21));
  if (body.length() > 21) { tft.setCursor(2, 138); tft.print(fit(body.substring(21), 21)); }
  // Bottom line: the timer, or the flow combo.
  tft.setCursor(2, 150);
  if (secsTotal > 0) {
    char buf[24]; sprintf(buf, "%s %02ld:%02ld", ringKind == 'B' ? "BREAK" : "FOCUS", secsLeft / 60, secsLeft % 60);
    tft.setTextColor(ringKind == 'B' ? GREEN : CYAN); tft.print(buf);
  }
  if (flow > 0) { tft.setTextColor(flow >= 6 ? 0xFE80 : CYAN); tft.setCursor(80, 150); tft.print("FLOW x"); tft.print(flow); }
}

void pulse() {
  for (int i = 0; i < 4; i++) tft.drawRect(i, i, W - 2 * i, H - 2 * i, RED);
  tft.fillRect(0, 114, W, H - 114, BG);
  tft.setTextColor(RED); tft.setTextSize(1);
  tft.setCursor(4, 120); tft.print("STILL DRIFTING");
  tft.setCursor(4, 134); tft.print("TAP YOUR BREAK CARD");
  tft.setCursor(4, 146); tft.print("OR GO BACK");
}

void handle(const String& cmd) {
  if (cmd.length() < 1) return;
  char op = cmd[0];
  String arg = cmd.length() > 2 ? cmd.substring(2) : "";
  if (op == 'S') { int a = arg.toInt(); int sp = arg.indexOf(' '); int b = sp > 0 ? arg.substring(sp + 1).toInt() : stage; pose = constrain(a, 0, 4); stage = constrain(b, 1, 4); lastDrawnFrame = -1; }
  else if (op == 'T') { int s1 = arg.indexOf(' '), s2 = arg.indexOf(' ', s1 + 1); secsLeft = arg.toInt(); secsTotal = arg.substring(s1 + 1, s2).toInt(); ringKind = s2 > 0 ? arg[s2 + 1] : '-'; ringDirty = true; textDirty = true; }
  else if (op == 'Q') { quest = arg; textDirty = true; }
  else if (op == 'N') { nextStep = arg; textDirty = true; }
  else if (op == 'F') { flow = arg.toInt(); textDirty = true; }
  else if (op == 'M') { message = arg; messageUntil = millis() + 20000; textDirty = true; }
  else if (op == 'L') { pulseUntil = millis() + 4000; pulse(); }
  else if (op == 'C') { cheerUntil = millis() + 3000; }
  else if (op == 'P') { Serial.println("HELLO nudgling-desk 1"); }
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_PIN, INPUT_PULLUP);
  SPI.begin(18, 19, 23);
  tft.initR(INITR_BLACKTAB);  // if colours or edges look wrong, try INITR_GREENTAB or INITR_REDTAB
  tft.setRotation(0);
  tft.fillScreen(BG);
  rfid.PCD_Init();
  drawRing();
  drawText();
  Serial.println("HELLO nudgling-desk 1");
}

void loop() {
  // Lines from the PC.
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { line.trim(); handle(line); line = ""; }
    else if (line.length() < 120) line += ch;
  }

  // A card: report its id (the same card is ignored for 2 s).
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uid = "";
    for (byte i = 0; i < rfid.uid.size; i++) { if (rfid.uid.uidByte[i] < 0x10) uid += "0"; uid += String(rfid.uid.uidByte[i], HEX); }
    uid.toUpperCase();
    if (uid != lastCard || millis() - lastCardAt > 2000) { Serial.print("CARD "); Serial.println(uid); cheerUntil = millis() + 1500; }
    lastCard = uid; lastCardAt = millis();
    rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
  }

  // The button: "done".
  static bool wasDown = false;
  bool down = digitalRead(BTN_PIN) == LOW;
  if (down && !wasDown) Serial.println("BTN 1");
  wasDown = down;

  // Animation: two frames per pose, 2.5 per second.
  if (millis() - lastFrame > 400) {
    lastFrame = millis(); frameN ^= 1;
    int p = millis() < cheerUntil ? POSE_CHEER : pose;
    int f = ((stage - 1) * 5 + p) * 2 + frameN;
    // The ring crosses the corners of the sprite's square, so it is redrawn on top.
    if (f != lastDrawnFrame) { drawSprite(f); drawRing(); lastDrawnFrame = f; }
  }

  // The countdown runs locally between updates from the PC.
  if (millis() - lastTick >= 1000) {
    lastTick = millis();
    if (secsLeft > 0) { secsLeft--; ringDirty = true; textDirty = true; }
    if (message.length() && millis() > messageUntil) { message = ""; textDirty = true; }
  }
  static bool pulsing = false;
  if (millis() < pulseUntil) { pulsing = true; return; }  // keep the red pulse on screen
  if (pulsing) {  // pulse over: clear its border, redraw the rest
    pulsing = false;
    for (int i = 0; i < 4; i++) tft.drawRect(i, i, W - 2 * i, H - 2 * i, BG);
    ringDirty = textDirty = true; lastDrawnFrame = -1;
  }
  if (ringDirty) { drawRing(); ringDirty = false; }
  if (textDirty) { drawText(); textDirty = false; }
}
