param([string]$Dir, [string]$OutFile)
# Part of the body-double video build (video/build.mjs). Needs ffmpeg on PATH.
# Narrate each manifest sentence (Windows SAPI), pair it with its frame,
# and join everything into one MP4 plus an SRT caption file.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$manifest = Get-Content (Join-Path $Dir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = 0
$list = @(); $srt = @(); $t = 0.0; $i = 0
function Ts([double]$s) { $ts = [TimeSpan]::FromSeconds($s); '{0:00}:{1:00}:{2:00},{3:000}' -f [int][math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds, $ts.Milliseconds }
foreach ($m in $manifest) {
  $i++
  # Your own recording wins: video/voice/<n>.wav (e.g. 03-01.wav), one per caption line.
  $own = Join-Path (Split-Path -Parent $PSCommandPath) "voice\$($m.n).wav"
  if (Test-Path $own) { $wav = $own } else {
    $wav = Join-Path $Dir "say$($m.n).wav"
    $synth.SetOutputToWaveFile($wav)
    $synth.Speak($m.say)
    $synth.SetOutputToNull()
  }
  $dur = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $wav)
  $pad = if ($m.last) { 0.9 } else { 0.25 }
  $len = [math]::Round($dur + $pad, 2)
  $seg = Join-Path $Dir "seg$($m.n).mp4"
  & ffmpeg -y -v error -loop 1 -framerate 30 -i (Join-Path $Dir "frame$($m.n).png") -i $wav -af "apad" -t $len -c:v libx264 -tune stillimage -pix_fmt yuv420p -r 30 -c:a aac -ar 48000 -ac 2 -b:a 128k $seg
  $list += "file '$($seg -replace '\\','/')'"
  $srt += "$i`n$(Ts $t) --> $(Ts ($t + $dur))`n$($m.say)`n"
  $t += $len
}
$synth.Dispose()
$listFile = Join-Path $Dir 'concat.txt'
[IO.File]::WriteAllLines($listFile, $list)
& ffmpeg -y -v error -f concat -safe 0 -i $listFile -c copy $OutFile
[IO.File]::WriteAllText(($OutFile -replace '\.mp4$', '.srt'), ($srt -join "`n"), (New-Object Text.UTF8Encoding $false))
"duration_s=$([math]::Round($t,1)) segments=$i out=$OutFile"
