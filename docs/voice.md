# Speech recognition and voice conversations

Official documentation checked on 2026-11-27. ChatGPT documents GPT-Live for its current Live voice mode. Claude documents voice conversations with its ordinary Claude models, but its voice-mode help page does not identify the speech-recognition backend. This integration uses documented OpenAI APIs, with a separate API key.

In Settings > Voice, choose GPT-Transcribe for recorded speech, or keep an installed local model. Spoken language supports automatic detection, English, Chinese, or mixed Chinese/English. Research vocabulary and selected project/conversation names supply spelling hints. The recognizer transcribes faithfully without rewriting or inventing missing speech. Existing explicit model choices remain; unset cloud preferences default to GPT-Transcribe.

Voice chat is separate from dictation. Open an agent conversation and use the waveform beside the dictation microphone. GPT-Live listens, speaks and handles overlapping speech through WebRTC, while client delegation uses the selected agent and its project context. An OpenAI key with GPT-Live access is required; API voice billing is separate from CLI subscriptions. Audio and recent text context go to OpenAI during the call. Spoken replies are synthesized paraphrases; canonical delegated requests and agent replies remain in text chat.

Mute affects microphone tracks. End releases the microphone and closes voice; backend agent jobs continue. The embedding adapter ends voice when leaving the conversation. Approvals remain on screen and cannot be granted by voice. Errors leave text chat usable; unconfirmed final usage is identified explicitly.

The standard API key stays in the main process. Main exchanges SDP through `POST /v1/live/sessions`; renderer receives only the answer and opaque ID. After `session.started`, transcript fragments assemble before client delegation, which is scoped to one task and deduplicated by delegation ID. Main returns verified assistant output or honest working/waiting/failure status. Bounded Unicode-safe `session.commentary.append` updates carry results. Closing sends `session.close`, waits for `session.closed`, and has a bounded transport-cleanup fallback.

Tests cover hints, error redaction, task ownership, duplicate dispatch, pending approval, cancelled waiters, fragment assembly, microphone teardown and graceful close. Desktop checks exercise settings and complete mocked calls in both interfaces. Protocol tests do not establish actual microphone accuracy or account access.

Official references:

- [ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice)
- [Claude voice mode](https://support.claude.com/en/articles/11101966-use-voice-mode)
- [Transcription](https://developers.openai.com/api/docs/guides/transcription)
- [Voice-agent architectures](https://developers.openai.com/api/docs/guides/voice-agents)
- [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [Client delegation](https://developers.openai.com/api/docs/guides/live-delegation)
