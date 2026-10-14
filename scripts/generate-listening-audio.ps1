# 使用本機 Windows 英語語音預先製作原創題包。App 本身不呼叫語音 API。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = Join-Path $taskRoot 'node_modules/.listening-wav'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskQuestions = Get-Content -LiteralPath (Join-Path $taskRoot 'src/fixtures/listening-part2.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskSynth.SelectVoice('Microsoft Zira Desktop')
$taskSynth.Rate = -1
$taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
  foreach ($taskQuestion in $taskQuestions) {
    $taskPrompt = New-Object System.Speech.Synthesis.PromptBuilder
    $taskPrompt.AppendText($taskQuestion.prompt)
    foreach ($taskKey in @('A','B','C')) {
      $taskPrompt.AppendBreak([TimeSpan]::FromMilliseconds(700))
      $taskPrompt.AppendText("$taskKey. $($taskQuestion.options.$taskKey)")
    }
    $taskSynth.SetOutputToWaveFile((Join-Path $taskOutput "$($taskQuestion.id)-question.wav"), $taskFormat)
    $taskSynth.Speak($taskPrompt)
    $taskSynth.SetOutputToNull()
    $taskSynth.SetOutputToWaveFile((Join-Path $taskOutput "$($taskQuestion.id)-review.wav"), $taskFormat)
    $taskSynth.Speak("The correct answer is $($taskQuestion.correct_key). $($taskQuestion.options.($taskQuestion.correct_key)) $($taskQuestion.explanation_en)")
    $taskSynth.SetOutputToNull()
  }
} finally { $taskSynth.Dispose() }
python (Join-Path $PSScriptRoot 'encode-listening-audio.py')
if ($LASTEXITCODE -ne 0) { throw '音訊編碼失敗' }
