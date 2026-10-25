# Only generate second-batch assets; first-batch WAV/MP3 and manifests are untouched.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskFixture = Join-Path $taskRoot 'src/fixtures/listening-part2-batch2.json'
$taskManifest = Join-Path $taskRoot 'src/fixtures/listening-batch2-audio.json'
if (Test-Path -LiteralPath $taskManifest) {
  $taskExisting = Get-Content -LiteralPath $taskManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskHash = (Get-FileHash -LiteralPath $taskFixture -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($taskExisting.source_sha256 -ne $taskHash) { throw 'Question source changed. Use a new audio version; do not reuse existing WAVs.' }
}
$taskOutput = Join-Path $taskRoot 'node_modules/.listening-wav'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskQuestions = Get-Content -LiteralPath $taskFixture -Raw -Encoding UTF8 | ConvertFrom-Json
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskSynth.SelectVoice('Microsoft Zira Desktop')
$taskSynth.Rate = -1
$taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
  foreach ($taskQuestion in $taskQuestions) {
    foreach ($taskKind in @('question', 'review')) {
      $taskTarget = Join-Path $taskOutput "$($taskQuestion.id)-$taskKind.wav"
      # Reuse existing source WAVs; a content change needs a new audio version.
      if (Test-Path -LiteralPath $taskTarget) { continue }
      $taskPrompt = New-Object System.Speech.Synthesis.PromptBuilder
      if ($taskKind -eq 'question') {
        $taskPrompt.AppendText($taskQuestion.prompt)
        foreach ($taskKey in @('A','B','C')) {
          $taskPrompt.AppendBreak([TimeSpan]::FromMilliseconds(700))
          $taskPrompt.AppendText("$taskKey. $($taskQuestion.options.$taskKey)")
        }
      } else {
        $taskPrompt.AppendText("The correct answer is $($taskQuestion.correct_key). $($taskQuestion.options.($taskQuestion.correct_key)) $($taskQuestion.explanation_en)")
      }
      $taskSynth.SetOutputToWaveFile($taskTarget, $taskFormat)
      $taskSynth.Speak($taskPrompt)
      $taskSynth.SetOutputToNull()
    }
  }
} finally { $taskSynth.Dispose() }
python (Join-Path $PSScriptRoot 'encode-listening-batch2.py')
if ($LASTEXITCODE -ne 0) { throw 'Second-batch audio encoding failed' }
