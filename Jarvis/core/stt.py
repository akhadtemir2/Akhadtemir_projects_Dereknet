"""
Speech-to-Text engines for MARK XL.

Whisper  – offline transcription via faster-whisper (VAD-buffered)
Vosk     – offline streaming transcription (lighter)
"""
import json
import re

import numpy as np


class WhisperSTT:
    """Offline transcription using faster-whisper."""

    def __init__(self, model_name: str = "base", language: str | None = None):
        import os
        from faster_whisper import WhisperModel
        print(f"[STT] Loading Whisper '{model_name}'…")
        try:
            import torch
            device  = "cuda" if torch.cuda.is_available() else "cpu"
            compute = "float16" if device == "cuda" else "int8"
        except Exception:
            device, compute = "cpu", "int8"

        try:
            self._model = WhisperModel(model_name, device=device, compute_type=compute)
        except Exception as _first_err:
            # Offline flag set but model not cached yet → clear flags and download once.
            # Keywords cover multiple huggingface_hub error message variants across versions.
            _e = str(_first_err).lower()
            _offline_keywords = (
                "offline", "not found", "cache", "localentry",
                "does not exist", "outgoing", "local_files_only",
            )
            if any(k in _e for k in _offline_keywords):
                print(f"[STT] Whisper '{model_name}' not in local cache — downloading (one-time, internet required)…")
                os.environ.pop("HF_HUB_OFFLINE",      None)
                os.environ.pop("TRANSFORMERS_OFFLINE", None)
                os.environ.pop("HF_DATASETS_OFFLINE",  None)
                try:
                    self._model = WhisperModel(model_name, device=device, compute_type=compute)
                except Exception as _dl_err:
                    raise RuntimeError(
                        f"Whisper '{model_name}' model download failed.\n"
                        f"Internet access is required the first time to download the speech model (~75–290 MB).\n"
                        f"After the first download it runs fully offline.\n"
                        f"Details: {_dl_err}"
                    ) from _dl_err
            else:
                raise

        self._language = None if (not language or language.strip().lower() == "auto") else language.strip().lower()
        print(f"[STT] Whisper '{model_name}' ready ({device})")

    def transcribe(self, audio: np.ndarray) -> str:
        """Transcribe a float32 mono 16 kHz numpy array. Returns transcript string."""
        try:
            segments, _ = self._model.transcribe(
                audio,
                language=self._language,
                beam_size=1,                       # greedy — 2-3x faster
                best_of=1,
                condition_on_previous_text=False,  # no hallucinations, faster
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
            )
            return " ".join(s.text for s in segments).strip()
        except Exception as e:
            print(f"[STT] Transcription error: {e}")
            raise


class STTUnavailableError(RuntimeError):
    """The STT engine is permanently unusable (no credit / rejected key).

    Distinct from a transient transcription failure on purpose: a transient
    error is worth swallowing and retrying on the next utterance, while this one
    means EVERY future call fails too. Returning "" for it (the old behaviour)
    made the microphone look alive while silently discarding every word the user
    said — the caller must be able to tell the two apart so it can fall back."""


class OpenAITranscribeSTT:
    """Online transcription via OpenAI's gpt-4o-transcribe."""

    def __init__(self, api_key: str, model: str = "gpt-4o-transcribe", prompt: str | None = None):
        from openai import OpenAI
        self._client = OpenAI(api_key=api_key)
        self._model = model
        # Language bias. The API's `language` param accepts only ONE ISO code,
        # which would penalise a trilingual (Kazakh/Russian/English) speaker, so
        # instead we pass a short prompt written in those scripts. This steers
        # decoding toward Cyrillic/Latin and away from the spurious Korean/CJK
        # the model otherwise emits on ambiguous or near-silent audio.
        self._prompt = prompt or (
            "Әңгіме қазақ, орыс немесе ағылшын тілінде. "
            "Conversation in Kazakh, Russian, or English."
        )
        print(f"[STT] OpenAI '{model}' ready")

    # Error markers that mean "this engine will never work again this run".
    _FATAL_MARKERS = (
        "insufficient_quota", "credit_balance_exhausted", "no credits remaining",
        "exceeded your current quota", "billing_hard_limit_reached",
        "invalid_api_key", "incorrect api key",
    )

    def _is_prompt_echo(self, text: str) -> bool:
        """True when `text` is really just our own `prompt` coming back.

        gpt-4o-transcribe (a Whisper descendant) regurgitates its `prompt`
        verbatim when the audio is silence or noise. Our prompt is a fixed
        language hint the user would never actually SAY, so a transcript that
        matches it — the whole thing or one of its sentences — is a
        hallucination, not speech. Observed 2026-08-19: the user sat silent
        after a reply and the app "heard" "Әңгіме қазақ, орыс немесе ағылшын
        тілінде." (this very hint) and answered a question nobody asked.
        Normalize away case/punctuation, then treat containment either way as
        a match."""
        def _norm(s: str) -> str:
            s = re.sub(r"[^\w\s]", " ", s.lower(), flags=re.UNICODE)
            return re.sub(r"\s+", " ", s).strip()
        t = _norm(text)
        if not t:
            return False
        for chunk in (self._prompt, *re.split(r"[.!?]", self._prompt)):
            c = _norm(chunk)
            if not c:
                continue
            if t == c:
                return True
            # Substring match only for reasonably long transcripts, so a short
            # real word ("да", "а", "о") can't accidentally match a slice of
            # the hint (its letters do appear inside "қазақ", "орыс", …).
            if len(t) >= 8 and (t in c or c in t):
                return True
        return False

    def transcribe_pcm16(self, pcm_bytes: bytes, sample_rate: int) -> str:
        """Transcribe raw mono 16-bit PCM audio. Blocking — call via a thread.

        Returns the transcript, "" on a transient failure, and raises
        STTUnavailableError when the account is out of credit or the key is
        rejected so the caller can switch to the offline engine."""
        import io
        import wave

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_bytes)
        buf.seek(0)
        buf.name = "utterance.wav"  # SDK uses this for the upload filename/mime hint

        try:
            result = self._client.audio.transcriptions.create(
                model=self._model,
                file=buf,
                prompt=self._prompt,
            )
            text = (result.text or "").strip()
            if text and self._is_prompt_echo(text):
                print("[STT] dropped prompt-echo on near-silent audio")
                return ""
            return text
        except Exception as e:
            print(f"[STT] gpt-4o-transcribe error: {e}")
            _msg = str(e).lower()
            if any(m in _msg for m in self._FATAL_MARKERS):
                raise STTUnavailableError(str(e)) from e
            return ""


class LocalWhisperSTT:
    """Offline faster-whisper wrapped in the OpenAITranscribeSTT interface.

    The fallback for when the online engine is out of credit. Same
    `transcribe_pcm16(bytes, rate)` signature so it is a drop-in for
    `self._stt`; costs nothing and needs no network once the model is cached.

    `base` is the default on purpose. Measured on this machine (CPU int8, no
    CUDA) against a 4.1 s utterance: base = 2.2 s (0.52x realtime), small =
    6.0 s (1.45x realtime). A transcriber slower than realtime feels like the
    app has hung again, which is the very thing this fallback exists to prevent.
    `small` is more accurate on Kazakh — set `"local_whisper_model": "small"` in
    config/api_keys.json to trade latency for accuracy."""

    def __init__(self, model_name: str = "base", language: str | None = None):
        self._inner = WhisperSTT(model_name=model_name, language=language)

    def transcribe_pcm16(self, pcm_bytes: bytes, sample_rate: int) -> str:
        if not pcm_bytes:
            return ""
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if sample_rate != 16000:
            # faster-whisper expects 16 kHz mono; linear resample is plenty for
            # speech and avoids pulling in scipy just for this path.
            n_out = int(round(audio.size * 16000 / float(sample_rate)))
            if n_out <= 0:
                return ""
            audio = np.interp(
                np.linspace(0.0, audio.size - 1, n_out, dtype=np.float64),
                np.arange(audio.size, dtype=np.float64),
                audio,
            ).astype(np.float32)
        try:
            return self._inner.transcribe(audio)
        except Exception as e:
            print(f"[STT] local whisper error: {e}")
            return ""


class VoskSTT:
    """Streaming transcription using Vosk."""

    def __init__(self, model_path: str | None = None, language: str = "en-us"):
        from vosk import Model, KaldiRecognizer
        print("[STT] Loading Vosk model…")
        if model_path:
            model = Model(model_path)
        else:
            lang  = language.strip().lower() if language and language.strip().lower() != "auto" else "en-us"
            model = Model(lang=lang)
        self._rec = KaldiRecognizer(model, 16000)
        print("[STT] Vosk ready.")

    def process_chunk(self, audio_bytes: bytes) -> tuple[str, bool]:
        """Feed raw int16 LE PCM bytes. Returns (text, is_final)."""
        if self._rec.AcceptWaveform(audio_bytes):
            result = json.loads(self._rec.Result())
            return result.get("text", ""), True
        partial = json.loads(self._rec.PartialResult())
        return partial.get("partial", ""), False
