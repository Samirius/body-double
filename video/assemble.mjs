#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const finalDir = path.join(here, 'final');
const segDir = path.join(finalDir, 'segments');
const audioDir = existsSync(path.join(finalDir, 'audio_heygen'))
  ? path.join(finalDir, 'audio_heygen')
  : path.join(finalDir, 'audio_neural');
const soundsDir = path.join(finalDir, 'sounds');

mkdirSync(segDir, { recursive: true });

const rawMkv = path.join(finalDir, 'take-raw.mkv');
const introMp4 = path.join(finalDir, 'intro.mp4');
const conceptMp4 = path.join(finalDir, 'concept.mp4');
const outroMp4 = path.join(finalDir, 'outro.mp4');

const run = (cmd, args, opts = {}) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited with code ${r.status}`);
};

const getDuration = (filePath) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
  return Number(r.stdout.toString().trim());
};

console.log('=== Step 1: Cutting and Preparing Video Segments from Fresh Take ===');

// Tight, fast-paced segment definitions:
// - VS Code and Chrome are sized to avoid the pet modal and its buttons
// - No dead silences or idle pauses
const plan = [
  // 1. Intro motion (8.0s)
  { id: '01_intro', src: introMp4, start: 0, dur: 8.0, speed: 1.0, title: 'Intro (3D Motion)' },
  // 2. Creature asks, user types quest (7.5s)
  { id: '02_ask_type', src: rawMkv, start: 0.0, dur: 7.5, speed: 1.0, title: 'Creature Asks & User Types Quest' },
  // 3. Llama plan appears, OK clicked (6.0s)
  { id: '03_plan_shown', src: rawMkv, start: 188.0, dur: 6.0, speed: 1.0, title: 'Llama Splits Quest into Steps' },
  // 4. Working in VS Code (7.5s)
  { id: '04_work_code', src: rawMkv, start: 197.5, dur: 7.5, speed: 1.0, title: 'Working in VS Code' },
  // 5a. YouTube drift begins (4.2s)
  { id: '05a_yt_drift', src: rawMkv, start: 213.3, dur: 4.2, speed: 1.0, title: 'Drifting to YouTube' },
  // 5b. Proactive nudge from Llama (7.0s)
  { id: '05b_yt_nudge', src: rawMkv, start: 307.5, dur: 7.0, speed: 1.0, title: 'Proactive Nudge from Local Llama' },
  // 6a. Ignored -> BOMB explosion (7.5s)
  { id: '06a_bomb', src: rawMkv, start: 314.5, dur: 7.5, speed: 1.0, title: 'Ignored Escalation (Bomb Explosion!)' },
  // 6b. Back to work -> Comeback bonus XP (6.5s)
  { id: '06b_comeback', src: rawMkv, start: 341.0, dur: 6.5, speed: 1.0, title: 'Comeback Bonus (+10 XP)' },
  // 7a. Scope check in terminal (4.0s)
  { id: '07a_scope_ask', src: rawMkv, start: 347.5, dur: 4.0, speed: 1.0, title: 'Agent Scope Check Triggered' },
  // 7b. Scope warning caught & parked (6.0s)
  { id: '07b_scope_park', src: rawMkv, start: 362.5, dur: 6.0, speed: 1.0, title: 'Scope Warning Caught & Parked' },
  // 8. Creature menu & Focus Session start (6.0s)
  { id: '08_session_start', src: rawMkv, start: 371.5, dur: 6.0, speed: 1.0, title: 'Starting Focus Session (Ring Countdown)' },
  // 9. Work Timelapse -> FLOW combo -> Gold rain (10.2s, 28x speedup)
  { id: '09_timelapse', src: rawMkv, start: 401.0, dur: 286.0, speed: 28.0, title: 'Work Timelapse, Flow Combo & Gold Rain' },
  // 10. Card Lock test (snooze refused) (7.0s)
  { id: '10_lock_refuse', src: rawMkv, start: 736.0, dur: 7.0, speed: 1.0, title: 'Card Lock Active, Snooze Refused' },
  // 11. RFID Card tap & break unlocked (7.0s)
  { id: '11_card_unlock', src: rawMkv, start: 828.5, dur: 7.0, speed: 1.0, title: 'RFID Card Tap Unlock' },
  // 12a. Steps done & boss defeat (4.5s)
  { id: '12a_boss', src: rawMkv, start: 839.5, dur: 4.5, speed: 1.0, title: 'Boss Defeat (+XP)' },
  // 12b. HUD panel opened showing local Llama 3.2 3B (6.5s)
  { id: '12b_hud', src: rawMkv, start: 846.0, dur: 6.5, speed: 1.0, title: 'Local Meta Llama HUD' },
  // 13. Hardware Concept (3D clip-on monitor companion) (8.5s)
  { id: '13_concept', src: conceptMp4, start: 2.0, dur: 8.5, speed: 1.0, title: 'Hardware Concept: ESP32, RFID Reader & Cards' },
  // 14. Outro Motion (6.0s)
  { id: '14_outro', src: outroMp4, start: 0, dur: 6.0, speed: 1.0, title: 'Attribution & Outro (3D Motion)' }
];

const segmentFiles = [];
const chapterMarks = [];
let currentTimelineT = 0;

for (const seg of plan) {
  const segFile = path.join(segDir, `${seg.id}.mp4`);
  chapterMarks.push({ id: seg.id, start: currentTimelineT, title: seg.title });
  
  if (!existsSync(segFile)) {
    console.log(`Processing segment: ${seg.id} (${seg.title}) ...`);
    if (seg.speed === 1.0) {
      run('ffmpeg', [
        '-y', '-ss', String(seg.start), '-i', seg.src,
        '-t', String(seg.dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-an',
        segFile
      ]);
    } else {
      const ptsScale = (1 / seg.speed).toFixed(5);
      run('ffmpeg', [
        '-y', '-ss', String(seg.start), '-i', seg.src,
        '-t', String(seg.dur),
        '-vf', `setpts=${ptsScale}*PTS,fps=30`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-an',
        segFile
      ]);
    }
  } else {
    console.log(`Segment ${seg.id} already exists, reusing.`);
  }

  const actualDur = getDuration(segFile);
  currentTimelineT += actualDur;
  segmentFiles.push(segFile);
}

console.log(`Total assembled video length will be: ${currentTimelineT.toFixed(2)}s (~${Math.floor(currentTimelineT/60)}m ${Math.round(currentTimelineT%60)}s)`);

// Create concat list
const concatListFile = path.join(segDir, 'concat.txt');
writeFileSync(concatListFile, segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));

console.log('=== Step 2: Concatenating Video Track ===');
const silentVideo = path.join(finalDir, 'nudgling-demo-silent.mp4');
run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListFile, '-c', 'copy', silentVideo]);

console.log('=== Step 3: Mixing Audio Narration + Sound Effects ===');
console.log('Timeline markers:');
chapterMarks.forEach(c => console.log(`  [${c.start.toFixed(1).padStart(6)}s] ${c.id}: ${c.title}`));

// Tight, seamlessly synced audio events:
const audioEvents = [
  // 1. Intro narration (0.0s -> 8.0s)
  { file: path.join(audioDir, '01_intro.wav'), at: 0.5, vol: 1.0 },
  // 2. Ask & Plan narration (8.0s -> 21.5s)
  { file: path.join(audioDir, '02_ask_plan.wav'), at: 8.2, vol: 1.0 },
  { file: path.join(soundsDir, 'happy.wav'), at: 18.0, vol: 0.8 }, // Plan accepted chime
  // 3. Work & YouTube Drift (21.5s -> 40.2s)
  { file: path.join(audioDir, '03_work_drift.wav'), at: 22.0, vol: 1.0 },
  { file: path.join(soundsDir, 'hm.wav'), at: 34.0, vol: 0.8 }, // Drift nudge
  // 4. Bomb & Return (40.2s -> 54.2s)
  { file: path.join(audioDir, '04_bomb_return.wav'), at: 40.5, vol: 1.0 },
  { file: path.join(soundsDir, 'boom.wav'), at: 44.5, vol: 0.95 }, // Bomb explosion!
  { file: path.join(soundsDir, 'happy.wav'), at: 50.5, vol: 0.8 }, // Comeback XP
  // 5. Scope Guard (54.2s -> 64.2s)
  { file: path.join(audioDir, '05_scope.wav'), at: 54.5, vol: 1.0 },
  { file: path.join(soundsDir, 'sigh.wav'), at: 59.0, vol: 0.7 },
  // 6. Focus Session (64.2s -> 70.2s)
  { file: path.join(audioDir, '06_session.wav'), at: 64.5, vol: 1.0 },
  { file: path.join(soundsDir, 'hm.wav'), at: 65.5, vol: 0.75 },
  // 7. Work timelapse, Flow combo & Gold rain (70.2s -> 80.4s)
  { file: path.join(audioDir, '07_lapse_gold.wav'), at: 70.5, vol: 1.0 },
  { file: path.join(soundsDir, 'chime.wav'), at: 74.0, vol: 0.85 }, // FLOW x1
  { file: path.join(soundsDir, 'celebrate.wav'), at: 77.5, vol: 0.95 }, // Gold rain!
  // 8. Card Lock (80.4s -> 87.4s)
  { file: path.join(audioDir, '08_card_lock.wav'), at: 80.6, vol: 1.0 },
  { file: path.join(soundsDir, 'angry.wav'), at: 84.0, vol: 0.85 }, // Snooze refused!
  // 9. Card Tap Unlock & Boss (87.4s -> 94.4s)
  { file: path.join(audioDir, '09_card_tap_boss.wav'), at: 87.6, vol: 1.0 },
  { file: path.join(soundsDir, 'ooh.wav'), at: 88.5, vol: 0.8 }, // Card tap
  // 10. Boss Defeat & Local Meta Llama HUD (94.4s -> 105.4s)
  { file: path.join(soundsDir, 'celebrate.wav'), at: 96.0, vol: 0.95 }, // Boss defeated!
  { file: path.join(audioDir, '10_hud_llama.wav'), at: 97.0, vol: 1.0 },
  // 11. Hardware Concept (105.4s -> 113.9s)
  { file: path.join(audioDir, '11_concept.wav'), at: 105.6, vol: 1.0 },
  { file: path.join(soundsDir, 'ooh.wav'), at: 109.5, vol: 0.8 },
  // 12. Outro (113.9s -> 119.9s)
  { file: path.join(audioDir, '12_outro.wav'), at: 114.2, vol: 1.0 },
  { file: path.join(soundsDir, 'celebrate.wav'), at: 118.5, vol: 0.9 }
];

// Build ffmpeg complex filter for mixing
const audioInputs = [];
const filterChains = [];
const mixLabels = [];

audioEvents.forEach((ev, idx) => {
  audioInputs.push('-i', ev.file);
  const ms = Math.round(ev.at * 1000);
  const vol = ev.vol || 1.0;
  filterChains.push(`[${idx}:a]aresample=48000,adelay=${ms}|${ms},volume=${vol.toFixed(2)}[a${idx}]`);
  mixLabels.push(`[a${idx}]`);
});

const totalSeconds = Math.ceil(currentTimelineT);
filterChains.push(
  `${mixLabels.join('')}amix=inputs=${audioEvents.length}:duration=longest:dropout_transition=0,apad=whole_dur=${totalSeconds}[mixout]`
);

const filterComplex = filterChains.join('; ');
const mixedAudio = path.join(finalDir, 'nudgling-demo-audio.wav');

run('ffmpeg', [
  '-y',
  ...audioInputs,
  '-filter_complex', filterComplex,
  '-map', '[mixout]',
  '-c:a', 'pcm_s16le',
  '-ar', '48000',
  '-ac', '2',
  mixedAudio
]);

console.log('=== Step 4: Generating Synced Subtitles (.srt) ===');

function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

const narrationItems = [
  { at: 0.5, dur: 7.50, text: "I have ADHD. Every focus app waits for me to open it. I don't. So I built one that speaks first." },
  { at: 8.2, dur: 8.36, text: "This is Nudgling, living at the bottom of my screen. It asks what I'm working on, then uses Meta's Llama to break the task into tiny steps." },
  { at: 22.0, dur: 8.44, text: "I start working. When I drift to YouTube, it doesn't shame me. It speaks first, offering one next action that takes under two minutes." },
  { at: 40.5, dur: 8.10, text: "Ignore it, and it gets dramatic: a pixel bomb rolls across my screen. Come back to work, and I earn bonus XP." },
  { at: 54.5, dur: 7.80, text: "It catches scope creep, too. Ask for dark mode mid-bug-fix, and it parks that idea for later." },
  { at: 64.5, dur: 4.44, text: "I click the creature to start a focus session. The ring counts down around it." },
  { at: 70.5, dur: 7.68, text: "Every minute in focus builds my combo. The creature glows brighter. Finish a session with zero drift, and gold rains down." },
  { at: 80.6, dur: 7.03, text: "When I need serious focus, the card lock disables snooze until I physically tap my RFID card." },
  { at: 87.6, dur: 5.88, text: "Tap my card, and I unlock a break. Each finished step chips away at the deadline boss and unlocks cosmetics." },
  { at: 97.0, dur: 7.63, text: "Llama runs locally, right on my PC. Window titles and screen data stay private. No cloud keys needed." },
  { at: 105.6, dur: 7.63, text: "We even designed clip-on hardware: an ESP32 companion with RFID cards for hands-on, screen-free control." },
  { at: 114.2, dur: 4.81, text: "Nudgling isn't another productivity app. It's an open-source body double that speaks first." }
];

let srtContent = '';
narrationItems.forEach((n, idx) => {
  srtContent += `${idx + 1}\n`;
  srtContent += `${formatSrtTime(n.at)} --> ${formatSrtTime(n.at + n.dur)}\n`;
  srtContent += `${n.text}\n\n`;
});

const srtFile = path.join(finalDir, 'nudgling-demo.srt');
writeFileSync(srtFile, srtContent.trim() + '\n', 'utf8');
console.log(`Wrote subtitles to: ${srtFile}`);

console.log('=== Step 5: Muxing Final Submission Video ===');
const finalMp4 = path.join(finalDir, 'nudgling-demo.mp4');

run('ffmpeg', [
  '-y',
  '-i', silentVideo,
  '-i', mixedAudio,
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '192k',
  '-shortest',
  finalMp4
]);

console.log('========================================================');
console.log(`SUCCESS! Master submission video rendered:`);
console.log(`  File:     ${finalMp4}`);
console.log(`  Duration: ${getDuration(finalMp4).toFixed(1)}s`);
console.log(`  Subtitles: ${srtFile}`);
console.log(`  Silent Cut (for live voiceover): ${silentVideo}`);
console.log('========================================================');
