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
$list = @(); $srt = @(); $t = 0.0; $i = 0; $clipT = @{}
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
  # The Nudgling's own robot sounds under the narration, each at its moment.
  if ($m.sfx -and @($m.sfx).Count -gt 0) {
    $inputs = @('-i', $wav); $chains = @(); $labels = '[0:a]'; $k = 0
    foreach ($s in @($m.sfx)) {
      $k++; $inputs += @('-i', $s.file)
      $ms = [int]([double]$s.at * 1000)
      $chains += "[$($k):a]adelay=$($ms)|$($ms),volume=0.7[s$k]"; $labels += "[s$k]"
    }
    $mixed = Join-Path $Dir "mix$($m.n).wav"
    $graph = ($chains -join ';') + ";$($labels)amix=inputs=$($k + 1):duration=longest:normalize=0[a]"
    & ffmpeg -y -v error @inputs -filter_complex $graph -map '[a]' -ar 48000 $mixed
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg sfx mix failed on $($m.n)" }
    $wav = $mixed
    $dur = [math]::Max($dur, [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $wav) - 0.6)
  }
  $pad = if ($m.last) { 0.9 } else { 0.25 }
  $len = [math]::Round($dur + $pad, 2)
  $seg = Join-Path $Dir "seg$($m.n).mp4"
  $slotFile = Join-Path $Dir "frame$($m.n).slot.json"
  if ($m.clip -and (Test-Path $slotFile)) {
    # A real clip of the app plays inside the slide's slot, continuing across the
    # slide's sentences (start frame = time already shown, wrapped).
    $slot = Get-Content $slotFile -Raw | ConvertFrom-Json
    if (-not $clipT.ContainsKey($m.clip.name)) { $clipT[$m.clip.name] = 0.0 }
    $start = [int]([math]::Floor($clipT[$m.clip.name] * $m.clip.fps)) % [int]$m.clip.frames
    $clipT[$m.clip.name] += $len
    $fc = "[1:v]scale=$($slot.w):$($slot.h):flags=neighbor,fps=30[c];[0:v][c]overlay=$($slot.x):$($slot.y):shortest=0[v];[2:a]apad[a]"
    & ffmpeg -y -v error -loop 1 -framerate 30 -i (Join-Path $Dir "frame$($m.n).png") -stream_loop -1 -framerate $m.clip.fps -start_number $start -i (Join-Path $m.clip.dir '%04d.png') -i $wav -filter_complex $fc -map '[v]' -map '[a]' -t $len -c:v libx264 -pix_fmt yuv420p -r 30 -c:a aac -ar 48000 -ac 2 -b:a 128k $seg
  } else {
    & ffmpeg -y -v error -loop 1 -framerate 30 -i (Join-Path $Dir "frame$($m.n).png") -i $wav -af "apad" -t $len -c:v libx264 -tune stillimage -pix_fmt yuv420p -r 30 -c:a aac -ar 48000 -ac 2 -b:a 128k $seg
  }
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed on segment $($m.n)" }
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
