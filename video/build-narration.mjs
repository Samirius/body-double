import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'final', 'audio');
mkdirSync(outDir, { recursive: true });

export const SCRIPT = [
  {
    id: '01_intro',
    targetStart: 0.0,
    text: "I have ADHD. Every focus app waits for me to open it. I never do. So I built one that speaks first.",
    sfx: []
  },
  {
    id: '02_ask_plan',
    targetStart: 13.0,
    text: "This is the Nudgling. It lives at the bottom of my screen. First it asks what I'm working on, and Meta's Llama splits it into tiny steps.",
    sfx: [{ name: 'happy', delay: 12.0 }]
  },
  {
    id: '03_work_drift',
    targetStart: 28.5,
    text: "I start working. But when I drift to YouTube, it doesn't lecture me. It speaks first with one next action under two minutes.",
    sfx: [{ name: 'hm', delay: 18.0 }]
  },
  {
    id: '04_bomb_return',
    targetStart: 57.0,
    text: "And if I ignore it, it gets a little dramatic. A bomb across the screen. When I return to work, it welcomes me back with bonus XP.",
    sfx: [{ name: 'boom', delay: 4.5 }, { name: 'happy', delay: 9.0 }]
  },
  {
    id: '05_scope',
    targetStart: 69.5,
    text: "It also watches my scope. When I ask my AI agent for a dark mode in the middle of a bug fix, it catches the scope creep so I can park it for later.",
    sfx: [{ name: 'sigh', delay: 4.0 }]
  },
  {
    id: '06_session',
    targetStart: 78.0,
    text: "Click the creature to start a focus session. A ring counts down around it.",
    sfx: [{ name: 'hm', delay: 2.0 }]
  },
  {
    id: '07_lapse_gold',
    targetStart: 90.0,
    text: "As I stay focused, flow builds a combo with an expanding aura. A perfect session with zero drift rains gold.",
    sfx: [{ name: 'chime', delay: 6.0 }, { name: 'celebrate', delay: 11.0 }]
  },
  {
    id: '08_card_lock',
    targetStart: 105.0,
    text: "For serious focus, the physical card lock prevents snoozing. Clicking snooze is refused until I tap my card.",
    sfx: [{ name: 'angry', delay: 8.0 }]
  },
  {
    id: '09_card_tap_boss',
    targetStart: 116.5,
    text: "A quick tap unlocks a break. Finishing steps defeats the deadline boss, unlocking cosmetics.",
    sfx: [{ name: 'ooh', delay: 2.0 }, { name: 'celebrate', delay: 11.0 }]
  },
  {
    id: '10_hud_llama',
    targetStart: 132.0,
    text: "Meta's Llama runs right on my PC, so window titles and screen data never leave the machine. Zero cloud keys required.",
    sfx: [{ name: 'happy', delay: 2.0 }]
  },
  {
    id: '11_concept',
    targetStart: 155.0,
    text: "We also designed a clip-on desktop companion with an ESP32 and RFID cards for tactile, screen-free control.",
    sfx: [{ name: 'ooh', delay: 5.0 }]
  },
  {
    id: '12_outro',
    targetStart: 173.0,
    text: "It's not a productivity app. It's an open-source body double that speaks first.",
    sfx: [{ name: 'celebrate', delay: 2.0 }]
  }
];

const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = 0

$lines = Get-Content '${path.join(outDir, 'script.json').replace(/\\/g, '/')}' -Raw | ConvertFrom-Json
foreach ($item in $lines) {
    $wav = Join-Path '${outDir.replace(/\\/g, '/')}' "$($item.id).wav"
    $synth.SetOutputToWaveFile($wav)
    $synth.Speak($item.text)
    $synth.SetOutputToNull()
    Write-Host "Synthesized: $($item.id)"
}
`;

writeFileSync(path.join(outDir, 'script.json'), JSON.stringify(SCRIPT, null, 2));
writeFileSync(path.join(outDir, 'synth.ps1'), psScript);

console.log('Synthesizing speech via SAPI...');
const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(outDir, 'synth.ps1')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('Speech synthesis failed');
  process.exit(1);
}
console.log('Speech synthesis complete.');
