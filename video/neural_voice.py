import asyncio
import os
import sys
import edge_tts

VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-US-ChristopherNeural"
OUT_DIR = os.path.join(os.path.dirname(__file__), "final", "audio_neural")
os.makedirs(OUT_DIR, exist_ok=True)

SCRIPT = [
    ("01_intro", "I have ADHD. Every focus app I've tried waits for me to open it. I never do. So I built one that speaks first."),
    ("02_ask_plan", "Meet the Nudgling. It lives at the bottom of my screen. First it asks what I'm working on, and Meta's Llama splits it into tiny, manageable steps."),
    ("03_work_drift", "I get to work. But when I drift to YouTube, it doesn't lecture me. It speaks first, offering one quick action I can finish in under two minutes."),
    ("04_bomb_return", "And if I ignore it, it gets a little dramatic. A bomb flies across the screen. When I return to work, it celebrates with bonus XP."),
    ("05_scope", "It also guards my scope. When I ask my AI agent to add a dark mode in the middle of a bug fix, Nudgling catches the scope creep so I can park it for later."),
    ("06_session", "Clicking the creature starts a focus session. A glowing ring counts down around it."),
    ("07_lapse_gold", "As I stay in the zone, flow builds a combo with an expanding aura. A perfect session with zero drift rewards me with gold rain."),
    ("08_card_lock", "For serious focus, the physical card lock prevents snoozing. Clicking snooze is refused until I tap my card."),
    ("09_card_tap_boss", "A quick tap unlocks a break. Finishing steps defeats the deadline boss, unlocking new cosmetics."),
    ("10_hud_llama", "Meta's Llama runs right on my PC, so window titles and screen data never leave the machine. Zero cloud keys required."),
    ("11_concept", "We also designed a physical desk companion with an ESP32 and RFID cards for tactile, screen-free focus control."),
    ("12_outro", "It's not just a productivity app. It's an open-source body double that speaks first.")
]

async def main():
    print(f"Generating neural voiceover using voice: {VOICE}")
    for item_id, text in SCRIPT:
        out_mp3 = os.path.join(OUT_DIR, f"{item_id}.mp3")
        out_wav = os.path.join(OUT_DIR, f"{item_id}.wav")
        communicate = edge_tts.Communicate(text, VOICE, rate="+3%")
        await communicate.save(out_mp3)
        # convert mp3 to wav 48k for ffmpeg mixing
        cmd = f'ffmpeg -y -v error -i "{out_mp3}" -ar 48000 -ac 2 "{out_wav}"'
        os.system(cmd)
        print(f"  Generated {item_id}: {text[:45]}...")
    print(f"All 12 neural voiceover files saved in {OUT_DIR}")

if __name__ == "__main__":
    asyncio.run(main())
