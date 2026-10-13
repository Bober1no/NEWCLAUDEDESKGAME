<#
.SYNOPSIS
    Speaks text typed into Local IP Cam, using THIS PC's voice.

.DESCRIPTION
    The phone never synthesises anything. It holds typed text in memory; this
    script polls for it, synthesises with Windows' built-in speech engine, and
    posts the resulting audio back to the phone's /talk endpoint, where it
    plays out of the phone's speaker.

    All the CPU cost is here. The phone's only work is playing a short clip of
    audio it was handed, which is the same thing the Talk button already does.

    Leave this running in a window while you want to use the Say box.

.EXAMPLE
    .\say-helper.ps1 -Phone http://10.0.0.78:8080 -User cam -Pass yourpassword

.EXAMPLE
    # Speak one thing and exit, without the viewer page
    .\say-helper.ps1 -Phone http://10.0.0.78:8080 -User cam -Pass pw -Once "dinner is ready"

.EXAMPLE
    # List the voices installed on this PC
    .\say-helper.ps1 -ListVoices
#>
[CmdletBinding()]
param(
    [string]$Phone = "http://10.0.0.78:8080",
    [string]$User  = "cam",
    [string]$Pass  = "changeme",
    # How often to ask the phone whether anything has been typed.
    [int]$PollMs = 700,
    # Must match the phone's audio sample rate, or playback is the wrong pitch.
    [int]$Rate = 16000,
    # Blank uses the Windows default voice. -ListVoices shows what is installed.
    [string]$Voice = "",
    # -10 (slow) to 10 (fast).
    [int]$Speed = 0,
    # 0 to 100.
    [int]$Volume = 100,
    # Speak this once and exit, instead of polling.
    [string]$Once = "",
    [switch]$ListVoices
)

$ErrorActionPreference = "Stop"

try {
    Add-Type -AssemblyName System.Speech
} catch {
    Write-Error "System.Speech is unavailable. This script needs Windows PowerShell on Windows."
    exit 1
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

if ($ListVoices) {
    Write-Host "Voices installed on this PC:" -ForegroundColor Cyan
    foreach ($v in $synth.GetInstalledVoices()) {
        if ($v.Enabled) { Write-Host ("  " + $v.VoiceInfo.Name) }
    }
    exit 0
}

if ($Voice -ne "") {
    try {
        $synth.SelectVoice($Voice)
    } catch {
        Write-Warning "Voice '$Voice' not found; using the default. Try -ListVoices."
    }
}
$synth.Rate   = [Math]::Max(-10, [Math]::Min(10, $Speed))
$synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))

$authValue = "Basic " + [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${User}:${Pass}"))
$headers = @{ Authorization = $authValue }

# Ask the engine for exactly the format the phone expects, so there is no
# resampling or header stripping anywhere in the chain.
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $Rate,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)

function Convert-TextToPcm {
    param([string]$Text)
    $stream = New-Object System.IO.MemoryStream
    try {
        # SetOutputToAudioStream writes RAW pcm in the given format.
        # (SetOutputToWaveStream would add a WAV header; the phone accepts
        # either, but raw keeps this simple.)
        $synth.SetOutputToAudioStream($stream, $format)
        $synth.Speak($Text)
        $synth.SetOutputToNull()
        return $stream.ToArray()
    } finally {
        $stream.Dispose()
    }
}

function Send-Pcm {
    param([byte[]]$Pcm)
    if ($Pcm.Length -eq 0) { return }
    # Send in slices: the phone caps a single POST, and smaller pieces start
    # playing sooner on a long sentence.
    $chunk = 32000                      # ~1s at 16kHz mono 16-bit
    for ($i = 0; $i -lt $Pcm.Length; $i += $chunk) {
        $size = [Math]::Min($chunk, $Pcm.Length - $i)
        $slice = New-Object byte[] $size
        [Array]::Copy($Pcm, $i, $slice, 0, $size)
        Invoke-WebRequest -Uri "$Phone/talk?rate=$Rate" -Method Post `
            -Headers $headers -Body $slice `
            -ContentType "application/octet-stream" `
            -TimeoutSec 15 -UseBasicParsing | Out-Null
    }
}

function Speak-Remote {
    param([string]$Text)
    Write-Host ("  speaking: " + $Text) -ForegroundColor Green
    Send-Pcm (Convert-TextToPcm $Text)
}

if ($Once -ne "") {
    Speak-Remote $Once
    exit 0
}

Write-Host "Local IP Cam speech helper" -ForegroundColor Cyan
Write-Host "  phone : $Phone"
Write-Host "  voice : $(if ($Voice) { $Voice } else { $synth.Voice.Name })"
Write-Host "  format: ${Rate}Hz mono 16-bit"
Write-Host "Polling for text. Ctrl+C to stop."
Write-Host ""

$warnedOffline = $false
while ($true) {
    try {
        $r = Invoke-WebRequest -Uri "$Phone/say/next" -Headers $headers `
                -TimeoutSec 10 -UseBasicParsing
        if ($warnedOffline) {
            Write-Host "Reconnected to the phone." -ForegroundColor Green
            $warnedOffline = $false
        }
        if ($r.StatusCode -eq 200 -and $r.Content) {
            $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
            if ($text.Trim() -ne "") { Speak-Remote $text }
            continue                    # drain a backlog without waiting
        }
    } catch {
        if (-not $warnedOffline) {
            Write-Warning ("Cannot reach the phone: " + $_.Exception.Message)
            Write-Warning "Check the address, the password, and that the stream is running."
            $warnedOffline = $true
        }
        Start-Sleep -Milliseconds 2000
        continue
    }
    Start-Sleep -Milliseconds $PollMs
}
