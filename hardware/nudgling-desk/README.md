# Nudgling Desk: the creature on your desk

An ESP32 with a 1.8" color screen and an RFID card reader. The same creature as on your PC stands on your desk
(it worries when you drift, cheers when you finish, shows the focus ring, your quest and next step), and **cards
are physical buttons**: tap one to start work, finish a step, take a break, or park a distraction.

## Parts

| Part | Notes |
|---|---|
| ESP32 dev board | any common one (CP2102 or CH340 USB chip) |
| RC522 RFID reader (13.56 MHz) | plus a few cards or key fobs |
| 1.8" TFT 128×160, ST7735 | the red SPI board |
| optional push button | "done", GPIO 14 to GND |

## Wiring (same as the arcade card project)

| Signal | RC522 | ST7735 | ESP32 |
|---|---|---|---|
| SCK | SCK | SCK | GPIO 18 |
| MOSI | MOSI | SDA/MOSI | GPIO 23 |
| MISO | MISO | – | GPIO 19 |
| Chip select | SDA (SS) | CS | GPIO 5 (RC522), GPIO 15 (TFT) |
| Reset | RST | RESET | GPIO 22 (RC522), GPIO 4 (TFT) |
| Data/command | – | DC (A0/RS) | GPIO 2 |
| Power | 3.3V | VCC + LED | 3.3V |
| Ground | GND | GND | GND |

## Flash it (Arduino IDE, about 10 minutes)

1. Plug the ESP32 into the PC with a **data** USB cable.
2. Arduino IDE → **File → Open** → `hardware/nudgling-desk/nudgling-desk.ino`.
3. **Tools → Board → esp32 → ESP32 Dev Module**, and **Tools → Port** → the new COM port.
4. **Library Manager** (left bar): make sure these are installed. On Samir's PC they already are.
   - *Adafruit ST7735 and ST7789 Library* (it brings Adafruit GFX and BusIO)
   - *MFRC522* (GithubCommunity)
5. Press **Upload** (→). If it waits at "Connecting....", hold the board's **BOOT** button until it starts.
6. The screen shows the creature and "Tap a card to start".

If the colours look wrong or there's a strip of noise at an edge, change `INITR_BLACKTAB` in the sketch to
`INITR_GREENTAB` or `INITR_REDTAB` and upload again.

## Use it

1. Keep Nudgling running on the PC. It finds the desk on USB by itself within 5 seconds, and the desk
   creature starts mirroring the one on screen.
2. **Tap a new card.** The creature on your PC asks *"New card! What should it do?"*:

   | Choice | What a tap does |
   |---|---|
   | **Focus** | starts a 25-minute focus session |
   | **Done** | finishes the next step |
   | **Break** | snoozes 10 minutes. With **Card lock** on, it's the only way to snooze. |
   | **Park** | saves whatever distracted you for later |
   | **This quest** | starts work on the active quest: focus ring, Claude opened with a kickoff prompt on the clipboard, the quest's links and folder |

3. **Card lock** (HUD → Settings): once a drift outlasts its allowance, the screen pulses red every minute
   until you go back to work or tap your **Break** card. Tip: keep that card across the room.

Without the reader you can still try every card from the PC: `node bin/nudgling.mjs card <any-id>`.

## For developers

- Protocol: one text line per message at 115200 baud; see the top of `nudgling-desk.ino`. The PC side is
  `src/desk.js` (tested with a simulated port in `test/desk.test.js`).
- `sprites.h` is generated from the app's pixel art: `node scripts/desk-sprites.mjs`.
- Compile check without a board:
  `arduino-cli compile --fqbn esp32:esp32:esp32 hardware/nudgling-desk` (27% of flash).
