# Optional direct co-op voice

**Unpublished local test candidate; Internet gateway enabled for it.** Room
controls, the in-game single-button layout and gray-muted/red-on colors were
visually approved on November 26, 2026. Focused automated source checks passed,
and macOS Apple Silicon / signed Android local packages were produced. Real
microphone and device testing remain outstanding. Screenshots use simulated
voice and memory-only saves, not a real microphone or players.

## LAN two-way audio and rejoin revision

Verified unpublished Android and Apple Silicon Mac test packages are under
**`build/local-test/lan-voice/`**. Use both new packages together for LAN; the
earlier packages under `build/local-test/voice-volume/` are a different payload.

- The answerer now uses the audio transceiver tied to the incoming offer, so
  both devices' microphones attach to the same negotiated bidirectional
  audio channel. Outgoing audio no longer waits for incoming playback to
  start before enabling a verified direct sender.
- Every replacement LAN pair gets fresh negotiation. An early authenticated
  voice hello waits for its own pair to open; bounded LAN-only retries cover
  mismatched readiness. Leaving retires the old pair's pending work, and
  stale completions cannot close the replacement pair.
- The existing **Voice on/off** toggle controls background music: it lowers
  to **10% of the chosen level** when voice chat is enabled, even in **Mute**
  or idle **PTT**, and returns to normal when voice chat is disabled or the
  room closes. The **Mic on** label and control layout are unchanged. Mic volume
  still defaults to 100%. Voice chat remains opt-in and never uses TURN.
- All 49 focused Node tests passed, including the answering sender, playback
  timing, voice-controlled BGM, and rejoining with leftover work. A live
  Chromium check received non-silent synthetic audio in both directions on the
  initial join and the rejoin on its diagnostic run; the first attempt did not
  connect. The build checks verified matching payloads, the Android signing
  identity and lint, and the Mac signature and ZIP. Confirm both directions and
  a second join on physical Android and macOS devices.

In the next source revision, the same toggle ducks **SFX to 50%** and
**Pokémon cries to 40%** of their chosen levels. BGM still ducks to 10%.
Independent audio gains keep the original game filters, master volume, saved
settings and voice playback intact. This addition is not in the previous local
test packages.

## Android capture / volume revision

After the first local build, the owner reported that Android accepted mic
permission but returned "microphone unavailable". The source now also declares
`MODIFY_AUDIO_SETTINGS`; Chromium's Android communication-device selection
checks that permission together with `RECORD_AUDIO`. This is a concrete missing
permission, not confirmation that the reported device has been repaired.

Approved on November 26, 2026, with **100% as the default mic level**. Updated
local packages were built after focused source and native checks:

- **Mic volume**, 0–100%, default **100%**, in Sound settings and the co-op room.
  It changes outgoing audio gain, not teammates' playback or the system volume.
  Keep intentional device preferences; absent or malformed values use 100%.
- This preference is stored only in this device's WebView/browser storage,
  outside the progression/cloud-save profile. Merely changing it never enables
  voice or asks for capture permission.
- An isolated broker-owned microphone gain bus applies the level before
  separate sender clones. It never connects the mic to local speakers or
  changes the direct-only/no-TURN policy.
- BGM ducks to **30% of the player's chosen music level** during ready open mic
  or active PTT, then restores on mute, release, failure or leaving. The saved
  music/master/SFX settings and original music fades are not rewritten.
- Capture failure diagnostics contain only an allowlisted error category, not
  device identifiers, exception text, signaling or credentials.

The earlier capture/volume candidate was packaged under
`build/local-test/voice-volume/` with a `MIC-FIX.apk`. Use the newer matching
LAN voice packages above to retest physical microphone capture.

## Controls

- Voice is optional and off by default for each participant. Enabling it
  initially listens with the microphone muted; it never forces teammates on.
- Room: enable/disable icon, **Mute**, **PTT**, **Mic on**, and a red
  **Hold to talk** button. Mute stops capture but keeps incoming audio.
- In-game: **one microphone button: gray when muted, red when on or talking**.
  Tap toggles muted/open mic; holding
  for 280 ms uses PTT. Release always mutes, even if the mic was previously open.
  A long hold must never become a click that latches the microphone on.
- Backquote (`) provides keyboard PTT. Release mutes in-game; the explicit
  room PTT mode remains selected after an ordinary room hold.
- Android: the in-game mic is icon-only, directly below the original Auto /
  Manual aim control. Auto is reduced from 50×62 to 44×44 CSS pixels; its
  behavior is unchanged. Room controls retain their normal layout.

## Transport and safety

- LAN audio uses a separate local-only peer connection with **no ICE servers**.
- Both Internet gameplay modes use separate, **STUN-only audio** connections.
  Gameplay may use TURN; audio never obtains TURN credentials or uses the
  gameplay PeerConnection/data channel.
- LAN descriptions use the authenticated private room wire; Internet
  descriptions use a separately validated Worker WebSocket message. Neither
  signaling path transports audio samples.
- Signaling is bounded, rate-limited and versioned. It permits one secure Opus
  audio section, not video, arbitrary data or relay candidates. Existing
  data-only gameplay SDP validation is unchanged.
- Audio tracks stay disabled until the selected pair is verified direct.
  Missing statistics/relay routes fail closed. Voice failure does not end a
  game or invoke the TURN issuer.
- Only the exact trusted native broker can request audio permission. The game
  renderer has no microphone/media networking or arbitrary IPC API. Mandatory
  system permission prompts cannot be replaced by a game dialog.
- PTT uses isolated preload input on desktop and actual MotionEvent/key hit
  tests on Android. A broker watchdog expires lost releases. Leave, background,
  permission cancellation and stale rooms stop capture; a late permission
  result must never reopen a released hold.
- Mono capture, a 24-kbit/s sender target, Opus DTX/FEC preferences and echo/noise
  reduction are requested. No recording, video, transcription or server mixer
  is added. Actual codec/device behavior still requires verification.

No save, signing identity or TURN credential storage is changed. Direct audio
uses participants' data; signaling uses existing service quotas. Do not claim
guaranteed zero billing or universal direct connectivity.

## Deployment and verification gate

On November 26, 2026, Worker version `562c80d5-b67b-4e8a-8997-fffec455cf9a`
enabled `voiceProtocol: 1` for Internet rooms and admitted the exact
`build/local-test/lan-voice/` payload. Both Internet modes passed live room
creation, code join and bidirectional voice signaling with disposable
code-only rooms. These checks carried no audio and requested no TURN
credentials. All eight existing build IDs, existing secret bindings and
room namespaces, and gameplay TURN settings were preserved. Both devices
must use matching builds for either LAN or Internet play.

November 26, 2026 volume/capture-revision verification:

- **71 Node tests passed** across voice policy/media mocks, gain and music buses,
  device-only preferences/defaults, isolated-preload gestures, broker/native
  boundaries, window controls and startup. Two older startup fixtures needed
  browser event/timer mocks; only those two and the affected preference case
  were rechecked.
- **34 Android native JVM tests passed**, including the 100% default/voice-off
  policy; release lint completed with zero issues.
- Packaged Android identity/signature and both capture/routing permissions were
  verified. Both native packages passed their game-payload integrity checks.
- No test contacts the live service, captures a real microphone or accesses a
  real save. The earlier baseline also covered LAN/gateway voice signaling.

Local packages are in `build/local-test/voice-volume/macos-arm64/` and
`build/local-test/voice-volume/android/`;
`build/local-test/voice-volume/voice-volume-local-test.json`
records hashes and their matching game digest. macOS architecture, branding,
ad-hoc signature, microphone disclosure and ZIP integrity were checked. Android
compiled with the existing signing identity. Its non-consuming physical-touch
observer has a narrowly scoped accessibility-lint exemption: DOM clicks and
WebView accessibility retain their normal handling, rather than synthesizing
an extra native click on PTT release.

Real desktop/physical Android audio checks, actual permission prompts,
multitouch walking + PTT and cross-device/NAT connectivity remain pending device
testing of Internet voice. The owner confirmed LAN voice using the matching
local candidate; Internet audio itself still needs a test with two devices on
different networks. The Worker deployment did not publish a GitHub release.
